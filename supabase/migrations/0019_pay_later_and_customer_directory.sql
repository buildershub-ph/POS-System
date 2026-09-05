begin;

-- ---------------------------------------------------------------------------
-- 1. "Pay later": a completed sale (item already released to the customer)
--    can be posted with payment still pending, then marked paid afterwards.
--    This is distinct from a held/quotation reservation, where the item
--    itself hasn't left the store yet.
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists payment_status text not null default 'paid' check (payment_status in ('paid', 'pending'));
alter table public.sales add column if not exists paid_at timestamptz;
alter table public.sales add column if not exists paid_by uuid references public.profiles(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. A lightweight customer directory so repeat customers are recognised by
--    phone number (or name, if no phone was given) across visits.
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per phone number; customers without a phone are matched by name
-- best-effort (handled in create_sale below), so no uniqueness constraint
-- is enforced on name alone.
create unique index if not exists customers_phone_unique on public.customers (lower(phone)) where phone is not null and phone <> '';

alter table public.customers enable row level security;
drop policy if exists authenticated_read_customers on public.customers;
create policy authenticated_read_customers on public.customers for select to authenticated using (true);

alter table public.sales add column if not exists customer_id uuid references public.customers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Re-create create_sale: identical to migration 0018's version, plus
--    resolving/creating the customer record and setting payment_status.
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
  needs_approval boolean;
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
    if line_variant is null and line_custom_item_name is null then
      raise exception 'Every line needs either a catalogue product or a custom item name';
    end if;
    if line_variant is not null and line_location is null then
      raise exception 'Every catalogue sale line needs a storage location';
    end if;
    if line_quantity <= 0 then raise exception 'Sale line quantity must be greater than zero'; end if;

    needs_approval := line_variant is not null and line_price < line_srp and not can_approve;

    insert into public.sale_lines (
      sale_id, variant_id, location_id, custom_item_name, custom_sku, quantity, selling_unit,
      original_srp, actual_selling_price, discount_reason, approval_required, approved_by, approved_at
    ) values (
      sale_uuid, line_variant, line_location, line_custom_item_name, line_custom_sku, line_quantity, line_unit,
      line_srp, line_price, line_discount_reason, needs_approval,
      case when line_variant is not null and line_price < line_srp and can_approve then actor_id end,
      case when line_variant is not null and line_price < line_srp and can_approve then now() end
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
-- 4. Records payment on a completed sale that was posted with "pay later".
-- ---------------------------------------------------------------------------
alter table public.sale_events drop constraint if exists sale_events_action_check;
alter table public.sale_events add constraint sale_events_action_check
  check (action in ('created_held', 'created_quotation', 'created_completed', 'completed', 'cancelled', 'payment_recorded'));

create or replace function public.record_sale_payment(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  target_sale_id uuid;
  sale_row public.sales;
  paid_at_value timestamptz;
  payment_method_value text;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager', 'sales_employee', 'cashier') then
    raise exception 'Role cannot process sales';
  end if;

  target_sale_id := (p_sale->>'saleId')::uuid;
  select * into sale_row from public.sales where id = target_sale_id;
  if not found then raise exception 'Sale not found'; end if;
  if sale_row.status <> 'completed' then raise exception 'Only a completed sale can have its payment recorded'; end if;
  if sale_row.payment_status = 'paid' then raise exception 'Payment has already been recorded for this sale'; end if;

  payment_method_value := nullif(p_sale->>'paymentMethod', '');
  if payment_method_value is null then raise exception 'A payment method is required'; end if;
  paid_at_value := coalesce(nullif(p_sale->>'paidAt', '')::timestamptz, now());

  update public.sales
  set payment_status = 'paid', paid_at = paid_at_value, paid_by = actor_id, payment_method = payment_method_value
  where id = target_sale_id;

  insert into public.sale_events (sale_id, action, actor_id) values (target_sale_id, 'payment_recorded', actor_id);

  return jsonb_build_object('id', target_sale_id, 'paymentStatus', 'paid');
end;
$$;

revoke all on function public.record_sale_payment(jsonb) from public, anon, authenticated;
grant execute on function public.record_sale_payment(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. sales_overview: append payment status/paid-by, so Transactions can
--    filter and show "pending payment" orders. Column order preserved.
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
    'sku', variant.sku
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
  sale.customer_id
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
-- 6. Backfill customers from existing sales (best-effort, same matching
--    rules as create_sale) so purchase history isn't empty for past sales.
-- ---------------------------------------------------------------------------
do $$
declare
  sale_row record;
  matched_id uuid;
begin
  for sale_row in select id, customer_name, customer_contact_number from public.sales where customer_id is null and customer_name is not null loop
    matched_id := null;
    if sale_row.customer_contact_number is not null and sale_row.customer_contact_number <> '' then
      select id into matched_id from public.customers where phone is not null and lower(phone) = lower(sale_row.customer_contact_number);
      if matched_id is null then
        insert into public.customers (name, phone) values (sale_row.customer_name, sale_row.customer_contact_number) returning id into matched_id;
      end if;
    else
      select id into matched_id from public.customers where phone is null and lower(name) = lower(sale_row.customer_name) limit 1;
      if matched_id is null then
        insert into public.customers (name, phone) values (sale_row.customer_name, null) returning id into matched_id;
      end if;
    end if;
    update public.sales set customer_id = matched_id where id = sale_row.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Purchase summary per customer -- powers the Customers page ranking.
-- ---------------------------------------------------------------------------
create or replace view public.customer_purchase_summary
with (security_invoker = true)
as
select
  customer.id,
  customer.name,
  customer.phone,
  count(sale.id) filter (where sale.status = 'completed') as completed_orders,
  coalesce(sum(line.quantity * line.actual_selling_price) filter (where sale.status = 'completed'), 0)::numeric(14,2) as total_spent,
  max(sale.created_at) filter (where sale.status = 'completed') as last_purchase_at,
  min(sale.created_at) filter (where sale.status = 'completed') as first_purchase_at
from public.customers customer
left join public.sales sale on sale.customer_id = customer.id
left join public.sale_lines line on line.sale_id = sale.id
group by customer.id;

grant select on public.customer_purchase_summary to authenticated;

commit;
