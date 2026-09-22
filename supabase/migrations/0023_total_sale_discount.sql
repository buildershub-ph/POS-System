begin;

-- ---------------------------------------------------------------------------
-- A discount applied to the whole sale (a peso amount knocked off the total),
-- separate from the existing per-line price override. Same governance as a
-- per-line discount: owner/manager auto-approve it, anyone else's total
-- discount is flagged for review.
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists total_discount_amount numeric(14,2) not null default 0 check (total_discount_amount >= 0);
alter table public.sales add column if not exists total_discount_reason text;
alter table public.sales add column if not exists total_discount_approval_required boolean not null default false;
alter table public.sales add column if not exists total_discount_approved_by uuid references public.profiles(id) on delete restrict;
alter table public.sales add column if not exists total_discount_approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Re-create create_sale: identical to migration 0022's version, plus
-- accepting totalDiscountAmount/totalDiscountReason. The discount is capped
-- to the sum of the sale's lines (computed in a pre-pass before the sales
-- row is inserted) so a sale can never net negative.
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
  line_brand text;
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
  sale_date_value timestamptz;
  line_subtotal numeric(14,2) := 0;
  total_discount_value numeric(14,2);
  total_discount_reason_value text;
  total_discount_needs_approval boolean;
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

  -- Only an owner/manager may backdate; anyone else's saleDate is ignored
  -- and the sale is timestamped now, same as before this migration.
  if can_approve then
    sale_date_value := nullif(p_sale->>'saleDate', '')::timestamptz;
    if sale_date_value is not null and sale_date_value > now() then
      raise exception 'Sale date cannot be in the future';
    end if;
  end if;

  -- Pre-pass over the lines, just to total them up so the whole-sale
  -- discount can be capped before anything is inserted.
  for line in select value from jsonb_array_elements(p_sale->'lines') loop
    line_subtotal := line_subtotal
      + greatest(coalesce(nullif(line->>'actualSellingPrice', '')::numeric, 0), 0)
      * coalesce(nullif(line->>'quantity', '')::numeric, 0);
  end loop;

  total_discount_value := greatest(coalesce(nullif(p_sale->>'totalDiscountAmount', '')::numeric, 0), 0);
  total_discount_value := least(total_discount_value, line_subtotal);
  total_discount_reason_value := nullif(trim(p_sale->>'totalDiscountReason'), '');
  total_discount_needs_approval := total_discount_value > 0 and not can_approve;

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
    customer_id, payment_status, created_at,
    total_discount_amount, total_discount_reason, total_discount_approval_required,
    total_discount_approved_by, total_discount_approved_at
  ) values (
    sale_uuid, sale_status, customer_name_value, contact_value,
    nullif(p_sale->>'fulfilmentMethod', ''),
    nullif(p_sale->>'paymentMethod', ''),
    nullif(trim(p_sale->>'notes'), ''),
    coalesce(nullif(p_sale->>'downpaymentAmount', '')::numeric, 0),
    inventory_txn_id, actor_id,
    case when sale_status = 'completed' then actor_id end,
    case when sale_status = 'completed' then coalesce(sale_date_value, now()) end,
    customer_uuid, payment_status_value, coalesce(sale_date_value, now()),
    total_discount_value, total_discount_reason_value, total_discount_needs_approval,
    case when total_discount_value > 0 and can_approve then actor_id end,
    case when total_discount_value > 0 and can_approve then now() end
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

    -- Only a Steelyes door needs a left/right swing choice -- this can't be
    -- changed once the door is ordered from the supplier, so it's enforced
    -- here, not just in the cashier UI.
    if line_variant is not null then
      select product.brand into line_brand
      from public.product_variants variant
      join public.products product on product.id = variant.product_id
      where variant.id = line_variant;

      needs_swing := coalesce(line_brand, '') = 'Steelyes';
      if needs_swing and line_door_swing is null then
        raise exception 'Select left or right swing for this Steelyes door';
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
  insert into public.sale_events (sale_id, action, actor_id, created_at) values (sale_uuid, event_action, actor_id, coalesce(sale_date_value, now()));

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
-- sales_overview: append the total-discount fields, a net_total_amount
-- (total_amount minus the whole-sale discount), and fold the discount into
-- balance_due. Existing column order preserved.
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
  greatest(
    coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.total_discount_amount - sale.downpayment_amount,
    0
  )::numeric(14,2) as balance_due,
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
  coalesce(bool_or(line.is_preorder), false) as has_preorder_items,
  sale.total_discount_amount,
  sale.total_discount_reason,
  sale.total_discount_approval_required,
  sale.total_discount_approved_by,
  approver.full_name as total_discount_approved_by_name,
  sale.total_discount_approved_at,
  greatest(coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.total_discount_amount, 0)::numeric(14,2) as net_total_amount
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
left join public.product_variants variant on variant.id = line.variant_id
left join public.products product on product.id = variant.product_id
left join public.profiles creator on creator.id = sale.created_by
left join public.profiles completer on completer.id = sale.completed_by
left join public.profiles canceller on canceller.id = sale.cancelled_by
left join public.profiles payer on payer.id = sale.paid_by
left join public.profiles approver on approver.id = sale.total_discount_approved_by
group by sale.id, creator.full_name, completer.full_name, canceller.full_name, payer.full_name, approver.full_name;

grant select on public.sales_overview to authenticated;

commit;
