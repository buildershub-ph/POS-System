begin;

-- ---------------------------------------------------------------------------
-- 1. Inclusions -- free text shown on the product page (e.g. what a door
--    package comes with, or an extra charge note like "JAMB AND HINGES:
--    Additional 2,800"). Optional, most items won't have one.
-- ---------------------------------------------------------------------------
alter table public.product_variants add column if not exists inclusions text;

-- Column order preserved, inclusions appended at the end.
create or replace view public.catalogue_variants
with (security_invoker = true)
as
select
  variant.id,
  product.id as product_id,
  product.name as product_name,
  category.name as category,
  product.brand,
  product.model,
  variant.sku,
  variant.barcode,
  variant.attributes,
  variant.selling_unit,
  variant.srp,
  variant.reorder_level,
  coalesce(sum(balance.available_quantity), 0)::numeric(14,3) as available_quantity,
  variant.default_location_id,
  location.name as default_location,
  coalesce(variant.photo_path, product.main_photo_path) as photo_path,
  variant.pieces_per_box,
  variant.sqm_per_box,
  variant.active,
  variant.supplier_sku,
  variant.supplier_id,
  supplier.name as supplier_name,
  location.company as default_location_company,
  variant.availability,
  variant.inclusions
from public.product_variants variant
join public.products product on product.id = variant.product_id
join public.categories category on category.id = product.category_id
left join public.inventory_balances balance on balance.variant_id = variant.id
left join public.locations location on location.id = variant.default_location_id
left join public.suppliers supplier on supplier.id = variant.supplier_id
where product.active = true
group by variant.id, product.id, category.id, location.id, supplier.id;

create or replace view public.portal_catalogue
with (security_invoker = true)
as
select
  catalogue.id,
  catalogue.product_id,
  catalogue.product_name,
  catalogue.category,
  catalogue.brand,
  catalogue.model,
  catalogue.sku,
  catalogue.barcode,
  catalogue.attributes,
  catalogue.selling_unit,
  catalogue.srp,
  catalogue.reorder_level,
  catalogue.available_quantity,
  catalogue.default_location_id,
  catalogue.default_location,
  catalogue.photo_path,
  catalogue.pieces_per_box,
  catalogue.sqm_per_box,
  catalogue.active,
  coalesce(incoming.incoming_quantity, 0)::numeric(14,3) as incoming_quantity,
  incoming.source_invoice,
  incoming.delivery_reference,
  incoming.delivery_date,
  incoming.draft_transaction_id,
  catalogue.supplier_sku,
  catalogue.supplier_id,
  catalogue.supplier_name,
  catalogue.default_location_company,
  catalogue.availability,
  catalogue.inclusions
from public.catalogue_variants catalogue
left join lateral (
  select
    sum(line.quantity_delta) as incoming_quantity,
    max(transaction.reference_number) as source_invoice,
    max(transaction.delivery_reference) as delivery_reference,
    max(transaction.created_at::date) as delivery_date,
    (array_agg(transaction.id order by transaction.created_at desc))[1] as draft_transaction_id
  from public.inventory_transaction_lines line
  join public.inventory_transactions transaction on transaction.id = line.transaction_id
  where line.variant_id = catalogue.id
    and transaction.transaction_type = 'receiving'
    and transaction.status = 'draft'
) incoming on true;

grant select on public.catalogue_variants to authenticated;
grant select on public.portal_catalogue to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Track, per sale line, whether it was a pre-order at the time of sale
--    (stock was 0 or the item is display-only) and which door swing the
--    customer chose (left/right) -- both facts that must be captured at
--    sale time since stock levels and product data change afterward.
-- ---------------------------------------------------------------------------
alter table public.sale_lines add column if not exists is_preorder boolean not null default false;
alter table public.sale_lines add column if not exists door_swing text check (door_swing in ('left', 'right'));

-- ---------------------------------------------------------------------------
-- 3. Re-create create_sale: identical to migration 0019's version, plus
--    accepting isPreorder/doorSwing per line and requiring a swing choice
--    on any non-jamb Filhome Builders door line.
-- ---------------------------------------------------------------------------
create or replace function public.create_sale(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  can_approve boolean;
  sale_status public.sale_status;
  sale_uuid uuid := gen_random_uuid();
  inventory_txn_id uuid;
  line jsonb;
  line_variant uuid;
  line_location uuid;
  line_quantity numeric(14,3);
  line_unit public.selling_unit;
  line_srp numeric(14,2);
  line_price numeric(14,2);
  line_discount_reason text;
  line_custom_item_name text;
  line_custom_sku text;
  line_is_preorder boolean;
  line_door_swing text;
  line_category text;
  line_supplier text;
  needs_approval boolean;
  needs_swing boolean;
  txn_lines jsonb;
  sale_row public.sales;
  customer_name_value text;
  contact_value text;
  customer_uuid uuid;
  event_action text;
  pay_later boolean;
  payment_status_value text;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager', 'sales_employee', 'cashier') then
    raise exception 'Role cannot process sales';
  end if;
  can_approve := actor_role in ('owner', 'manager');

  customer_name_value := nullif(trim(p_sale->>'customerName'), '');
  if customer_name_value is null then raise exception 'Customer full name is required'; end if;
  contact_value := nullif(trim(p_sale->>'customerContactNumber'), '');

  sale_status := coalesce(nullif(p_sale->>'status', '')::public.sale_status, 'completed');
  if sale_status not in ('held', 'quotation', 'completed') then
    raise exception 'Invalid sale status';
  end if;
  if jsonb_array_length(coalesce(p_sale->'lines', '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line';
  end if;

  -- Recognise a repeat customer by phone number first (most reliable), else
  -- fall back to matching an existing phone-less customer by name.
  if contact_value is not null then
    select id into customer_uuid from public.customers where phone is not null and lower(phone) = lower(contact_value);
  end if;
  if customer_uuid is null and contact_value is null then
    select id into customer_uuid from public.customers where phone is null and lower(name) = lower(customer_name_value) limit 1;
  end if;
  if customer_uuid is null then
    insert into public.customers (name, phone) values (customer_name_value, contact_value) returning id into customer_uuid;
  else
    update public.customers set name = customer_name_value, phone = coalesce(contact_value, phone), updated_at = now() where id = customer_uuid;
  end if;

  pay_later := coalesce((p_sale->>'payLater')::boolean, false);
  payment_status_value := case when sale_status = 'completed' and pay_later then 'pending' else 'paid' end;

  if sale_status = 'completed' then
    txn_lines := '[]'::jsonb;
    for line in select value from jsonb_array_elements(p_sale->'lines') loop
      if line->>'variantId' is not null and line->>'variantId' <> '' then
        txn_lines := txn_lines || jsonb_build_object(
          'variantId', line->>'variantId',
          'locationId', line->>'locationId',
          'quantityDelta', -((line->>'quantity')::numeric)
        );
      end if;
    end loop;
    if jsonb_array_length(txn_lines) > 0 then
      inventory_txn_id := public.post_inventory_transaction(jsonb_build_object(
        'type', 'sale',
        'actorId', actor_id,
        'reason', 'Point of sale',
        'lines', txn_lines
      ));
    end if;
  end if;

  insert into public.sales (
    id, status, customer_name, customer_contact_number, fulfilment_method, payment_method, notes,
    downpayment_amount, inventory_transaction_id, created_by, completed_by, completed_at,
    customer_id, payment_status
  ) values (
    sale_uuid, sale_status, customer_name_value, contact_value,
    nullif(p_sale->>'fulfilmentMethod', ''),
    nullif(p_sale->>'paymentMethod', ''),
    nullif(trim(p_sale->>'notes'), ''),
    coalesce(nullif(p_sale->>'downpaymentAmount', '')::numeric, 0),
    inventory_txn_id, actor_id,
    case when sale_status = 'completed' then actor_id end,
    case when sale_status = 'completed' then now() end,
    customer_uuid, payment_status_value
  ) returning * into sale_row;

  for line in select value from jsonb_array_elements(p_sale->'lines') loop
    line_variant := nullif(line->>'variantId', '')::uuid;
    line_location := nullif(line->>'locationId', '')::uuid;
    line_custom_item_name := nullif(trim(line->>'customItemName'), '');
    line_custom_sku := nullif(trim(line->>'customSku'), '');
    line_quantity := (line->>'quantity')::numeric;
    line_unit := coalesce(nullif(line->>'sellingUnit', '')::public.selling_unit, 'piece');
    line_srp := greatest(coalesce(nullif(line->>'originalSrp', '')::numeric, 0), 0);
    line_price := greatest(coalesce(nullif(line->>'actualSellingPrice', '')::numeric, 0), 0);
    line_discount_reason := nullif(trim(line->>'discountReason'), '');
    line_is_preorder := coalesce((line->>'isPreorder')::boolean, false);
    line_door_swing := nullif(lower(trim(line->>'doorSwing')), '');
    if line_door_swing is not null and line_door_swing not in ('left', 'right') then
      raise exception 'Door swing must be left or right';
    end if;
    if line_variant is null and line_custom_item_name is null then
      raise exception 'Every line needs either a catalogue product or a custom item name';
    end if;
    if line_variant is not null and line_location is null then
      raise exception 'Every catalogue sale line needs a storage location';
    end if;
    if line_quantity <= 0 then raise exception 'Sale line quantity must be greater than zero'; end if;

    -- Any non-jamb door supplied by Filhome Builders needs a left/right swing
    -- choice -- this can't be changed once the door is ordered from the
    -- supplier, so it's enforced here, not just in the cashier UI.
    if line_variant is not null then
      select category.name, supplier.name into line_category, line_supplier
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      join public.categories category on category.id = product.category_id
      left join public.suppliers supplier on supplier.id = variant.supplier_id
      where variant.id = line_variant;

      needs_swing := coalesce(line_supplier, '') = 'Filhome Builders' and coalesce(line_category, '') <> 'Door Jamb';
      if needs_swing and line_door_swing is null then
        raise exception 'Select left or right swing for this Filhome Builders door';
      end if;
    end if;

    needs_approval := line_variant is not null and line_price < line_srp and not can_approve;

    insert into public.sale_lines (
      sale_id, variant_id, location_id, custom_item_name, custom_sku, quantity, selling_unit,
      original_srp, actual_selling_price, discount_reason, approval_required, approved_by, approved_at,
      is_preorder, door_swing
    ) values (
      sale_uuid, line_variant, line_location, line_custom_item_name, line_custom_sku, line_quantity, line_unit,
      line_srp, line_price, line_discount_reason, needs_approval,
      case when line_variant is not null and line_price < line_srp and can_approve then actor_id end,
      case when line_variant is not null and line_price < line_srp and can_approve then now() end,
      line_is_preorder, line_door_swing
    );
  end loop;

  event_action := case sale_status when 'held' then 'created_held' when 'quotation' then 'created_quotation' else 'created_completed' end;
  insert into public.sale_events (sale_id, action, actor_id) values (sale_uuid, event_action, actor_id);

  return jsonb_build_object(
    'id', sale_uuid,
    'saleNumber', sale_row.sale_number,
    'status', sale_row.status,
    'inventoryTransactionId', inventory_txn_id
  );
end;
$$;

revoke all on function public.create_sale(jsonb) from public, anon, authenticated;
grant execute on function public.create_sale(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. sales_overview: append a sale-level "has a pre-order line" flag (for
--    the Transactions filter) and enrich each line item with isPreorder /
--    doorSwing. Existing column order preserved.
-- ---------------------------------------------------------------------------
create or replace view public.sales_overview
with (security_invoker = true)
as
select
  sale.id,
  sale.sale_number,
  sale.status,
  sale.customer_name,
  sale.fulfilment_method,
  sale.payment_method,
  sale.notes,
  sale.inventory_transaction_id,
  sale.created_by,
  sale.created_at,
  sale.completed_by,
  sale.completed_at,
  coalesce(sum(line.quantity * line.actual_selling_price), 0)::numeric(14,2) as total_amount,
  coalesce(sum(line.quantity * line.original_srp), 0)::numeric(14,2) as total_srp,
  count(line.id) as line_count,
  coalesce(jsonb_agg(jsonb_build_object(
    'variantId', line.variant_id,
    'customItemName', line.custom_item_name,
    'customSku', line.custom_sku,
    'quantity', line.quantity,
    'sellingUnit', line.selling_unit,
    'originalSrp', line.original_srp,
    'actualSellingPrice', line.actual_selling_price,
    'discountReason', line.discount_reason,
    'productName', product.name,
    'sku', variant.sku,
    'isPreorder', line.is_preorder,
    'doorSwing', line.door_swing
  ) order by line.id) filter (where line.id is not null), '[]'::jsonb) as line_items,
  sale.customer_contact_number,
  sale.downpayment_amount,
  sale.balance_paid_at,
  greatest(coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.downpayment_amount, 0)::numeric(14,2) as balance_due,
  sale.balance_payment_method,
  creator.full_name as created_by_name,
  completer.full_name as completed_by_name,
  sale.cancelled_by,
  sale.cancelled_at,
  canceller.full_name as cancelled_by_name,
  sale.payment_status,
  sale.paid_at,
  payer.full_name as paid_by_name,
  sale.customer_id,
  coalesce(bool_or(line.is_preorder), false) as has_preorder_items
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
left join public.product_variants variant on variant.id = line.variant_id
left join public.products product on product.id = variant.product_id
left join public.profiles creator on creator.id = sale.created_by
left join public.profiles completer on completer.id = sale.completed_by
left join public.profiles canceller on canceller.id = sale.cancelled_by
left join public.profiles payer on payer.id = sale.paid_by
group by sale.id, creator.full_name, completer.full_name, canceller.full_name, payer.full_name;

grant select on public.sales_overview to authenticated;

-- ---------------------------------------------------------------------------
-- 5. New items: a supplier "Filhome Builders", and its Steelyes/JBosch door
--    lines added by the owner. All start at 0 quantity (pre-order only --
--    they're shown in the catalogue and can still be sold, they just always
--    need to be ordered in from the supplier).
-- ---------------------------------------------------------------------------
-- New supplier for the Filhome Builders door lines (Steelyes + JBosch).
insert into public.suppliers (id, code, name, active) values ('0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'FILHOME', 'Filhome Builders', true) on conflict (id) do update set name = excluded.name, active = true;

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('4e8287aa-6fef-51d7-8663-708cb8e33205', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B29 80x210x70', 'Steelyes Deluxe Series', 'Own code: B29 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('6d53f6ba-0dd9-5669-91d0-f60ff339fa62', '4e8287aa-6fef-51d7-8663-708cb8e33205', 'DOR-B29-80X210X70', 'DOR-B29-80X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('6d53f6ba-0dd9-5669-91d0-f60ff339fa62', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('f2558e64-f0ee-5006-bf39-01eeb4d30092', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B28 80x210x70', 'Steelyes Deluxe Series', 'Own code: B28 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('ada0edbd-ef47-5236-a062-e4404f28956d', 'f2558e64-f0ee-5006-bf39-01eeb4d30092', 'DOR-B28-80X210X70', 'DOR-B28-80X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('ada0edbd-ef47-5236-a062-e4404f28956d', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('d22a33bd-a237-534a-a513-52f070fa461f', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B17 80x210x70', 'Steelyes Deluxe Series', 'Own code: B17 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('450fd553-f2de-5e4a-b33f-0e6ad29b6952', 'd22a33bd-a237-534a-a513-52f070fa461f', 'DOR-B17-80X210X70', 'DOR-B17-80X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('450fd553-f2de-5e4a-b33f-0e6ad29b6952', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('3c56f723-d021-5f58-a63c-14feaf8b02a3', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B35 80x210x70', 'Steelyes Deluxe Series', 'Own code: B35 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('b6fbeef5-652a-5c81-9dd9-7391a6f13c30', '3c56f723-d021-5f58-a63c-14feaf8b02a3', 'DOR-B35-80X210X70', 'DOR-B35-80X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('b6fbeef5-652a-5c81-9dd9-7391a6f13c30', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('ff099b9f-1ee4-50e9-9c63-25c1ebd6e7f7', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'A39 80x210x70', 'Steelyes Deluxe Series', 'Own code: A39 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f3f6dc15-0c96-5128-8dd6-7d95b343204f', 'ff099b9f-1ee4-50e9-9c63-25c1ebd6e7f7', 'DOR-A39-80X210X70', 'DOR-A39-80X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f3f6dc15-0c96-5128-8dd6-7d95b343204f', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('3225f011-1c9a-5a92-b805-2bedff4b4af4', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B29 90x210x70', 'Steelyes Deluxe Series', 'Own code: B29 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('6fa1e39b-d839-547a-95ba-71051aa53993', '3225f011-1c9a-5a92-b805-2bedff4b4af4', 'DOR-B29-90X210X70', 'DOR-B29-90X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('6fa1e39b-d839-547a-95ba-71051aa53993', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('6f1e6a96-2c43-59af-bc96-7cfbffc50a43', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B28 90x210x70', 'Steelyes Deluxe Series', 'Own code: B28 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('b4c9efb6-3f24-5a13-9ff1-686f96681d93', '6f1e6a96-2c43-59af-bc96-7cfbffc50a43', 'DOR-B28-90X210X70', 'DOR-B28-90X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('b4c9efb6-3f24-5a13-9ff1-686f96681d93', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('aaf350cc-ea9d-52e0-90e3-b1a958062c26', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B17 90x210x70', 'Steelyes Deluxe Series', 'Own code: B17 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('02ad17fd-8657-5edf-b6d9-0cf1b2fa12c4', 'aaf350cc-ea9d-52e0-90e3-b1a958062c26', 'DOR-B17-90X210X70', 'DOR-B17-90X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('02ad17fd-8657-5edf-b6d9-0cf1b2fa12c4', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('8fc116cb-ec78-54df-81fb-61a43d37ae80', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B35 90x210x70', 'Steelyes Deluxe Series', 'Own code: B35 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('e53be108-d815-51e1-9229-60f148f58e4a', '8fc116cb-ec78-54df-81fb-61a43d37ae80', 'DOR-B35-90X210X70', 'DOR-B35-90X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('e53be108-d815-51e1-9229-60f148f58e4a', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('c37996a6-25d7-554b-a1f9-7785af9b8ba5', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'A39 90x210x70', 'Steelyes Deluxe Series', 'Own code: A39 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('9e9b48ae-5aff-5fe2-9eed-27b7181b3598', 'c37996a6-25d7-554b-a1f9-7785af9b8ba5', 'DOR-A39-90X210X70', 'DOR-A39-90X210X70', '{}'::jsonb, 'piece', 13500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('9e9b48ae-5aff-5fe2-9eed-27b7181b3598', 9450, 9450, 9450, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('2815d85e-d309-5816-9650-f79754ddd78f', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B26 80x210x70', 'Steelyes Super Deluxe Series', 'Own code: B26 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('fb938241-59f4-58fb-a821-f3d8e44d79ea', '2815d85e-d309-5816-9650-f79754ddd78f', 'DOR-B26-80X210X70', 'DOR-B26-80X210X70', '{}'::jsonb, 'piece', 15500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('fb938241-59f4-58fb-a821-f3d8e44d79ea', 10850, 10850, 10850, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('3ad8097f-8d38-5efa-a334-9307571d42c9', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'A28 80x210x70', 'Steelyes Super Deluxe Series', 'Own code: A28 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('da925b4b-ec43-56a4-b673-b983ce394254', '3ad8097f-8d38-5efa-a334-9307571d42c9', 'DOR-A28-80X210X70', 'DOR-A28-80X210X70', '{}'::jsonb, 'piece', 15500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 90cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('da925b4b-ec43-56a4-b673-b983ce394254', 10850, 10850, 10850, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('862e2b49-a590-5aa8-a39d-3c29504e94db', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B26 90x210x70', 'Steelyes Super Deluxe Series', 'Own code: B26 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f9d4d85b-532e-58fd-9726-41cd67334ec7', '862e2b49-a590-5aa8-a39d-3c29504e94db', 'DOR-B26-90X210X70', 'DOR-B26-90X210X70', '{}'::jsonb, 'piece', 15500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f9d4d85b-532e-58fd-9726-41cd67334ec7', 10850, 10850, 10850, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('d7d9b22d-b008-50e1-9d05-95a39ce493e1', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'A28 90x210x70', 'Steelyes Super Deluxe Series', 'Own code: A28 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('679959d6-eac5-5dc1-9aa3-05bf32c8a9cd', 'd7d9b22d-b008-50e1-9d05-95a39ce493e1', 'DOR-A28-90X210X70', 'DOR-A28-90X210X70', '{}'::jsonb, 'piece', 15500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, MORTISE LOCKSET, DOOR VIEWER & DOOR BUZZER (JAMB SIZE: 100cmx217.6cmx100mm)', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('679959d6-eac5-5dc1-9aa3-05bf32c8a9cd', 10850, 10850, 10850, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('9227b45e-6fb2-5c57-acf8-263abe2fd03a', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B201 80x210x70', 'Steelyes High End Series', 'Own code: B201 80x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('8d3d693d-94c5-5087-8a4c-fba1c729b2ab', '9227b45e-6fb2-5c57-acf8-263abe2fd03a', 'DOR-B201-80X210X70', 'DOR-B201-80X210X70', '{}'::jsonb, 'piece', 16500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, LAMINATED PANEL MORTISE LOCKSET, DOOR VIEWE & DOOR CHIME (JAMB SIZE: 90cmx217.6cmx100mm)

*Designed for hotels
*Compatible with electronic locket smart lock or keycards', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('8d3d693d-94c5-5087-8a4c-fba1c729b2ab', 11550, 11550, 11550, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('856929b2-2d77-5969-b365-ddcba5ef3147', '10000000-0000-0000-0000-000000000003', 'Steelyes', 'B201 90x210x70', 'Steelyes High End Series', 'Own code: B201 90x210x70', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f87897ae-2ebf-5e51-b95e-6c652bed85d9', '856929b2-2d77-5969-b365-ddcba5ef3147', 'DOR-B201-90X210X70', 'DOR-B201-90X210X70', '{}'::jsonb, 'piece', 16500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', 'COMPLETE WITH JAMB, HINGES, LAMINATED PANEL MORTISE LOCKSET, DOOR VIEWE & DOOR CHIME (JAMB SIZE: 100cmx217.6cmx100mm)

*Designed for hotels
*Compatible with electronic locket smart lock or keycards', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f87897ae-2ebf-5e51-b95e-6c652bed85d9', 11550, 11550, 11550, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('c6ff5e5b-cfe1-5354-924f-dd537dbfa651', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Oak 70x210cm', 'JBosch Regular Series', 'Own code: Oak 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('5b81a623-de21-5419-8819-d0fe037d0848', 'c6ff5e5b-cfe1-5354-924f-dd537dbfa651', 'DOR-OAK-70X210CM', 'DOR-OAK-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('5b81a623-de21-5419-8819-d0fe037d0848', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('85624449-1985-5bf5-849d-8e16d1afd5d8', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Mahogany 70x210cm', 'JBosch Regular Series', 'Own code: Mahogany 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('11cd2285-713b-54fa-8c09-3281869f6af2', '85624449-1985-5bf5-849d-8e16d1afd5d8', 'DOR-MAHOGANY-70X210CM', 'DOR-MAHOGANY-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('11cd2285-713b-54fa-8c09-3281869f6af2', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('70443a95-d3d9-53dd-845b-f4c2acf8e4bb', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White 70x210cm', 'JBosch Regular Series', 'Own code: White 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f26f3ec2-4bca-5cba-b333-62878404e09d', '70443a95-d3d9-53dd-845b-f4c2acf8e4bb', 'DOR-WHITE-70X210CM', 'DOR-WHITE-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f26f3ec2-4bca-5cba-b333-62878404e09d', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('5a0cc762-1ba5-5d91-80ab-bb45ec24027b', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cinnamon 70x210cm', 'JBosch Regular Series', 'Own code: Cinnamon 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('20827c82-0c0b-5cd7-a59c-5697d1116b54', '5a0cc762-1ba5-5d91-80ab-bb45ec24027b', 'DOR-CINNAMON-70X210CM', 'DOR-CINNAMON-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('20827c82-0c0b-5cd7-a59c-5697d1116b54', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('1c0222fc-af6b-5b68-8e95-5025ad10fc45', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Walnut 70x210cm', 'JBosch Regular Series', 'Own code: Walnut 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('2809a198-7e34-5869-a98f-80d0e03e0b84', '1c0222fc-af6b-5b68-8e95-5025ad10fc45', 'DOR-WALNUT-70X210CM', 'DOR-WALNUT-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('2809a198-7e34-5869-a98f-80d0e03e0b84', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('d60462ec-1e4c-509d-ade6-200b68b7c638', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White Pine 70x210cm', 'JBosch Regular Series', 'Own code: White Pine 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('30fdf6ee-3416-5def-9bb6-53ede1f32674', 'd60462ec-1e4c-509d-ade6-200b68b7c638', 'DOR-WHITE-PINE-70X210CM', 'DOR-WHITE-PINE-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('30fdf6ee-3416-5def-9bb6-53ede1f32674', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('4bcd899f-9045-553f-9ffa-0c37b85b035b', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cedar 70x210cm', 'JBosch Regular Series', 'Own code: Cedar 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('6788e915-28db-54e7-9162-a01cfb353b6e', '4bcd899f-9045-553f-9ffa-0c37b85b035b', 'DOR-CEDAR-70X210CM', 'DOR-CEDAR-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('6788e915-28db-54e7-9162-a01cfb353b6e', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('0fae5d00-6dc6-5479-8817-a5c2d98dcbe2', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Teak 70x210cm', 'JBosch Regular Series', 'Own code: Teak 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('9486869c-ef7b-5821-998a-bbd07e1b6039', '0fae5d00-6dc6-5479-8817-a5c2d98dcbe2', 'DOR-TEAK-70X210CM', 'DOR-TEAK-70X210CM', '{}'::jsonb, 'piece', 8500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('9486869c-ef7b-5821-998a-bbd07e1b6039', 5950, 5950, 5950, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('4325265f-112d-54de-996a-0aa952a82760', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Oak 80x210cm', 'JBosch Regular Series', 'Own code: Oak 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f518bf6f-2635-5c8a-89c1-204a0fab9ee2', '4325265f-112d-54de-996a-0aa952a82760', 'DOR-OAK-80X210CM', 'DOR-OAK-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f518bf6f-2635-5c8a-89c1-204a0fab9ee2', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('88fc502d-670f-56ba-bce5-249110c003cc', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Mahogany 80x210cm', 'JBosch Regular Series', 'Own code: Mahogany 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('809e45ac-553a-5833-8fdc-19c5a425db69', '88fc502d-670f-56ba-bce5-249110c003cc', 'DOR-MAHOGANY-80X210CM', 'DOR-MAHOGANY-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('809e45ac-553a-5833-8fdc-19c5a425db69', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('fc5de0b5-4f13-50d0-bf77-01d676c7d948', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White 80x210cm', 'JBosch Regular Series', 'Own code: White 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('134d4b32-b339-5a6e-8809-08cc782f2936', 'fc5de0b5-4f13-50d0-bf77-01d676c7d948', 'DOR-WHITE-80X210CM', 'DOR-WHITE-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('134d4b32-b339-5a6e-8809-08cc782f2936', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('da6aceab-00fe-51cf-95bb-0dc31f955572', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cinnamon 80x210cm', 'JBosch Regular Series', 'Own code: Cinnamon 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('4a79f338-8f19-5711-9b91-00e36440b41f', 'da6aceab-00fe-51cf-95bb-0dc31f955572', 'DOR-CINNAMON-80X210CM', 'DOR-CINNAMON-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('4a79f338-8f19-5711-9b91-00e36440b41f', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('c3b38819-ff36-582a-8545-0122123d5e86', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Walnut 80x210cm', 'JBosch Regular Series', 'Own code: Walnut 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('7a64d94b-55f0-511f-8f5f-01637ab88bd0', 'c3b38819-ff36-582a-8545-0122123d5e86', 'DOR-WALNUT-80X210CM', 'DOR-WALNUT-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('7a64d94b-55f0-511f-8f5f-01637ab88bd0', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('a3814bd5-64dc-53e4-b9c3-aa86c477475e', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White Pine 80x210cm', 'JBosch Regular Series', 'Own code: White Pine 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('44e0518c-1ec4-5a31-aaf6-a77c1933e470', 'a3814bd5-64dc-53e4-b9c3-aa86c477475e', 'DOR-WHITE-PINE-80X210CM', 'DOR-WHITE-PINE-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('44e0518c-1ec4-5a31-aaf6-a77c1933e470', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('77c626a6-378e-52c8-a3d4-871520bc66e1', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cedar 80x210cm', 'JBosch Regular Series', 'Own code: Cedar 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('810309e2-81bc-5389-84a5-9165dc12c486', '77c626a6-378e-52c8-a3d4-871520bc66e1', 'DOR-CEDAR-80X210CM', 'DOR-CEDAR-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('810309e2-81bc-5389-84a5-9165dc12c486', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('cb1dc506-15a2-53b7-bdc6-2fdcfcbb1b41', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Teak 80x210cm', 'JBosch Regular Series', 'Own code: Teak 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('d1ed16f0-5e8c-5a73-a3e3-43857b6d49c7', 'cb1dc506-15a2-53b7-bdc6-2fdcfcbb1b41', 'DOR-TEAK-80X210CM', 'DOR-TEAK-80X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('d1ed16f0-5e8c-5a73-a3e3-43857b6d49c7', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('1bb40632-6b37-529b-8bf8-ea82dd03d982', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Oak 90x210cm', 'JBosch Regular Series', 'Own code: Oak 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('c0e2e909-2b15-5958-8ece-2d7158c6b1f5', '1bb40632-6b37-529b-8bf8-ea82dd03d982', 'DOR-OAK-90X210CM', 'DOR-OAK-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('c0e2e909-2b15-5958-8ece-2d7158c6b1f5', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('f13f2afc-388a-5a62-a9ca-0024be5fc27a', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Mahogany 90x210cm', 'JBosch Regular Series', 'Own code: Mahogany 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('cc57355a-2871-5d88-970f-f3e5bf2454db', 'f13f2afc-388a-5a62-a9ca-0024be5fc27a', 'DOR-MAHOGANY-90X210CM', 'DOR-MAHOGANY-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('cc57355a-2871-5d88-970f-f3e5bf2454db', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('d738400d-882e-5c9d-8457-49872d7ad0b8', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White 90x210cm', 'JBosch Regular Series', 'Own code: White 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('faacb761-ca77-5a2f-b798-f9aadab03db6', 'd738400d-882e-5c9d-8457-49872d7ad0b8', 'DOR-WHITE-90X210CM', 'DOR-WHITE-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('faacb761-ca77-5a2f-b798-f9aadab03db6', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('6be1c49a-e6c1-51f0-a513-2f9c4e961c5b', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cinnamon 90x210cm', 'JBosch Regular Series', 'Own code: Cinnamon 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('c6cf9b3c-7f9d-52fa-b064-533bfa06942a', '6be1c49a-e6c1-51f0-a513-2f9c4e961c5b', 'DOR-CINNAMON-90X210CM', 'DOR-CINNAMON-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('c6cf9b3c-7f9d-52fa-b064-533bfa06942a', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('24f7d2e0-a31c-5ddd-a63a-a0a406c58f77', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Walnut 90x210cm', 'JBosch Regular Series', 'Own code: Walnut 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('78ccbfcc-c8b4-5ee7-a820-186b8eadf3c8', '24f7d2e0-a31c-5ddd-a63a-a0a406c58f77', 'DOR-WALNUT-90X210CM', 'DOR-WALNUT-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('78ccbfcc-c8b4-5ee7-a820-186b8eadf3c8', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('8ed85976-c73a-5b4b-b5be-a60335c6dbde', '10000000-0000-0000-0000-000000000003', 'JBosch', 'White Pine 90x210cm', 'JBosch Regular Series', 'Own code: White Pine 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('16fe5282-2b23-54ca-9419-e5dfb8d6ff89', '8ed85976-c73a-5b4b-b5be-a60335c6dbde', 'DOR-WHITE-PINE-90X210CM', 'DOR-WHITE-PINE-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('16fe5282-2b23-54ca-9419-e5dfb8d6ff89', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('2545a6d0-03d5-5079-9ce5-9d0640311b89', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Cedar 90x210cm', 'JBosch Regular Series', 'Own code: Cedar 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('8d1e1482-ec95-50bf-a06c-993faaac5782', '2545a6d0-03d5-5079-9ce5-9d0640311b89', 'DOR-CEDAR-90X210CM', 'DOR-CEDAR-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('8d1e1482-ec95-50bf-a06c-993faaac5782', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('612289ae-879b-581c-bffc-0b86134fa8e0', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Teak 90x210cm', 'JBosch Regular Series', 'Own code: Teak 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('30ce569d-17be-552e-b0e4-14b0dc2f8687', '612289ae-879b-581c-bffc-0b86134fa8e0', 'DOR-TEAK-90X210CM', 'DOR-TEAK-90X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('30ce569d-17be-552e-b0e4-14b0dc2f8687', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('fcef7e01-5535-5b40-91d3-3865dd5d7cb4', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Ash Grey 70x210cm', 'JBosch Premium Series', 'Own code: Ash Grey 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f89873dc-8e7b-5519-8df2-e988c5fec678', 'fcef7e01-5535-5b40-91d3-3865dd5d7cb4', 'DOR-ASH-GREY-70X210CM', 'DOR-ASH-GREY-70X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f89873dc-8e7b-5519-8df2-e988c5fec678', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('36087a84-8aa2-5556-9c43-087b73a8e462', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Sap Wood 70x210cm', 'JBosch Premium Series', 'Own code: Sap Wood 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('6dfff88a-c947-5e6a-ab17-31c7fdf37436', '36087a84-8aa2-5556-9c43-087b73a8e462', 'DOR-SAP-WOOD-70X210CM', 'DOR-SAP-WOOD-70X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('6dfff88a-c947-5e6a-ab17-31c7fdf37436', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('1b55761a-27fa-5cc6-b5ff-3ad55cced345', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Rosewood 70x210cm', 'JBosch Premium Series', 'Own code: Rosewood 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('18ae1df7-7775-5385-95b6-849489468196', '1b55761a-27fa-5cc6-b5ff-3ad55cced345', 'DOR-ROSEWOOD-70X210CM', 'DOR-ROSEWOOD-70X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('18ae1df7-7775-5385-95b6-849489468196', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('35271d6a-af75-5a39-bad3-b6d4b48225ec', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Maple 70x210cm', 'JBosch Premium Series', 'Own code: Maple 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('489cc329-e84d-5514-932d-51b7e1f74f8e', '35271d6a-af75-5a39-bad3-b6d4b48225ec', 'DOR-MAPLE-70X210CM', 'DOR-MAPLE-70X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('489cc329-e84d-5514-932d-51b7e1f74f8e', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('6ebd0c2c-4fa6-5838-ae78-1c09aee2a3b6', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Elm Wood 70x210cm', 'JBosch Premium Series', 'Own code: Elm Wood 70x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('a396d9ec-4c30-5b27-ae9c-7c6293984a8b', '6ebd0c2c-4fa6-5838-ae78-1c09aee2a3b6', 'DOR-ELM-WOOD-70X210CM', 'DOR-ELM-WOOD-70X210CM', '{}'::jsonb, 'piece', 9500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('a396d9ec-4c30-5b27-ae9c-7c6293984a8b', 6650, 6650, 6650, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('031e264c-9765-58b7-9b82-ddb892cd1066', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Ash Grey 80x210cm', 'JBosch Premium Series', 'Own code: Ash Grey 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('b55d7344-82ab-5a45-ae53-4f5b5631ef7c', '031e264c-9765-58b7-9b82-ddb892cd1066', 'DOR-ASH-GREY-80X210CM', 'DOR-ASH-GREY-80X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('b55d7344-82ab-5a45-ae53-4f5b5631ef7c', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('84a52186-70ba-5273-a565-4f450806b0da', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Sap Wood 80x210cm', 'JBosch Premium Series', 'Own code: Sap Wood 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('c2f32986-79a5-5c30-9acc-d5bfee8c0acc', '84a52186-70ba-5273-a565-4f450806b0da', 'DOR-SAP-WOOD-80X210CM', 'DOR-SAP-WOOD-80X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('c2f32986-79a5-5c30-9acc-d5bfee8c0acc', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('12e5861a-b6bd-57dd-84e7-3086647a8c0f', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Rosewood 80x210cm', 'JBosch Premium Series', 'Own code: Rosewood 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('64c6423e-6b74-5ec5-8673-8d0281215566', '12e5861a-b6bd-57dd-84e7-3086647a8c0f', 'DOR-ROSEWOOD-80X210CM', 'DOR-ROSEWOOD-80X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('64c6423e-6b74-5ec5-8673-8d0281215566', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('13f6bf5c-4ac3-5ac9-a7d4-6877e3b2cecc', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Maple 80x210cm', 'JBosch Premium Series', 'Own code: Maple 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('7cf23aca-d7bb-5670-bcf2-13de7ec4149e', '13f6bf5c-4ac3-5ac9-a7d4-6877e3b2cecc', 'DOR-MAPLE-80X210CM', 'DOR-MAPLE-80X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('7cf23aca-d7bb-5670-bcf2-13de7ec4149e', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('190ca4c2-80e4-5f56-a75c-ca04bd552898', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Elm Wood 80x210cm', 'JBosch Premium Series', 'Own code: Elm Wood 80x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('f8de8a11-2630-5339-9aab-725461199f62', '190ca4c2-80e4-5f56-a75c-ca04bd552898', 'DOR-ELM-WOOD-80X210CM', 'DOR-ELM-WOOD-80X210CM', '{}'::jsonb, 'piece', 10500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('f8de8a11-2630-5339-9aab-725461199f62', 7350, 7350, 7350, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('605f56cd-3483-5da0-9dbb-0cf48f990dfd', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Ash Grey 90x210cm', 'JBosch Premium Series', 'Own code: Ash Grey 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('8addbc5b-c432-5978-905b-f235557066e5', '605f56cd-3483-5da0-9dbb-0cf48f990dfd', 'DOR-ASH-GREY-90X210CM', 'DOR-ASH-GREY-90X210CM', '{}'::jsonb, 'piece', 11500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('8addbc5b-c432-5978-905b-f235557066e5', 8050, 8050, 8050, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('df54ce1c-6b29-5db1-b28c-4a4ffe32c014', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Sap Wood 90x210cm', 'JBosch Premium Series', 'Own code: Sap Wood 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('55ba982e-58fd-5171-824a-74b5abefb4f5', 'df54ce1c-6b29-5db1-b28c-4a4ffe32c014', 'DOR-SAP-WOOD-90X210CM', 'DOR-SAP-WOOD-90X210CM', '{}'::jsonb, 'piece', 11500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('55ba982e-58fd-5171-824a-74b5abefb4f5', 8050, 8050, 8050, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('9b182d66-b78a-534d-80a9-555e0bae96da', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Rosewood 90x210cm', 'JBosch Premium Series', 'Own code: Rosewood 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('92aa24b2-906b-53e8-b581-d5ccc0c6f976', '9b182d66-b78a-534d-80a9-555e0bae96da', 'DOR-ROSEWOOD-90X210CM', 'DOR-ROSEWOOD-90X210CM', '{}'::jsonb, 'piece', 11500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('92aa24b2-906b-53e8-b581-d5ccc0c6f976', 8050, 8050, 8050, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('95c3b821-972a-5c14-8afe-130871d742ae', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Maple 90x210cm', 'JBosch Premium Series', 'Own code: Maple 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('29282461-700b-5e3d-9b49-9c3a896b129f', '95c3b821-972a-5c14-8afe-130871d742ae', 'DOR-MAPLE-90X210CM', 'DOR-MAPLE-90X210CM', '{}'::jsonb, 'piece', 11500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('29282461-700b-5e3d-9b49-9c3a896b129f', 8050, 8050, 8050, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('ffaf060d-400f-5196-8e73-deb2355b423a', '10000000-0000-0000-0000-000000000003', 'JBosch', 'Elm Wood 90x210cm', 'JBosch Premium Series', 'Own code: Elm Wood 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('aabad792-c74e-53be-bc2e-6f804fce66ba', 'ffaf060d-400f-5196-8e73-deb2355b423a', 'DOR-ELM-WOOD-90X210CM', 'DOR-ELM-WOOD-90X210CM', '{}'::jsonb, 'piece', 11500.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', '*JAMB AND HINGES: Additional 2,800', true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('aabad792-c74e-53be-bc2e-6f804fce66ba', 8050, 8050, 8050, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

insert into public.products (id, category_id, brand, model, name, description, active, created_by) values ('0dbb4619-15fe-5610-866a-b5f305e0a22f', '10000000-0000-0000-0000-00000000000a', 'JBosch', 'JBosch Jamb 90x210cm', 'JAMB JBosch Regular & Premium Series', 'Own code: JBosch Jamb 90x210cm', true, '00000000-0000-0000-0000-000000000001');
insert into public.product_variants (id, product_id, sku, barcode, attributes, selling_unit, srp, reorder_level, default_location_id, supplier_id, availability, inclusions, active, created_by) values ('bce3a9fd-ce64-5e91-880e-895fcf8d07f1', '0dbb4619-15fe-5610-866a-b5f305e0a22f', 'JAM-JBOSCH-JAMB-90X210CM', 'JAM-JBOSCH-JAMB-90X210CM', '{}'::jsonb, 'piece', 2800.0, 0, '20000000-0000-0000-0000-000000000001', '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', 'stocked', null, true, '00000000-0000-0000-0000-000000000001');
insert into public.variant_private_costs (variant_id, unit_cost, landed_cost, minimum_selling_price, supplier_id, effective_at, updated_by) values ('bce3a9fd-ce64-5e91-880e-895fcf8d07f1', 1960, 1960, 1960, '0671a8d4-e156-59bb-a84a-0dff0d0ff8e1', now(), '00000000-0000-0000-0000-000000000001');

commit;
