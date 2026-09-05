begin;

-- ---------------------------------------------------------------------------
-- 1. Every transaction is visible to every logged-in employee (old and new).
--    Previously a sale was only visible to whoever created it, plus
--    owner/manager. Replace those two policies with an open "any
--    authenticated user can read" rule. Creating/insert rules are untouched.
-- ---------------------------------------------------------------------------
drop policy if exists sales_team_read_sales on public.sales;
create policy authenticated_read_sales on public.sales for select to authenticated using (true);

drop policy if exists sales_team_read_lines on public.sale_lines;
create policy authenticated_read_sale_lines on public.sale_lines for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Record who cancelled a sale and when (previously only the generic
--    audit_log trigger captured this, with no easy way to show it).
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict;
alter table public.sales add column if not exists cancelled_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. A purpose-built history log per sale: one row per meaningful event
--    (created as held/quotation/completed, later completed, cancelled).
--    This answers "who made the sale" and "history of edits per transaction".
-- ---------------------------------------------------------------------------
create table if not exists public.sale_events (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  action text not null check (action in ('created_held', 'created_quotation', 'created_completed', 'completed', 'cancelled')),
  actor_id uuid references public.profiles(id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);

alter table public.sale_events enable row level security;
drop policy if exists authenticated_read_sale_events on public.sale_events;
create policy authenticated_read_sale_events on public.sale_events for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. Re-create create_sale / complete_sale / cancel_sale so each writes a
--    sale_events row for its own action. Everything else about these
--    functions is unchanged from migration 0017.
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
  event_action text;
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

  sale_status := coalesce(nullif(p_sale->>'status', '')::public.sale_status, 'completed');
  if sale_status not in ('held', 'quotation', 'completed') then
    raise exception 'Invalid sale status';
  end if;
  if jsonb_array_length(coalesce(p_sale->'lines', '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line';
  end if;

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
    downpayment_amount, inventory_transaction_id, created_by, completed_by, completed_at
  ) values (
    sale_uuid, sale_status, customer_name_value,
    nullif(trim(p_sale->>'customerContactNumber'), ''),
    nullif(p_sale->>'fulfilmentMethod', ''),
    nullif(p_sale->>'paymentMethod', ''),
    nullif(trim(p_sale->>'notes'), ''),
    coalesce(nullif(p_sale->>'downpaymentAmount', '')::numeric, 0),
    inventory_txn_id, actor_id,
    case when sale_status = 'completed' then actor_id end,
    case when sale_status = 'completed' then now() end
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

create or replace function public.complete_sale(p_sale jsonb)
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
  txn_lines jsonb := '[]'::jsonb;
  inventory_txn_id uuid;
  line_record public.sale_lines;
  balance_paid_value timestamptz;
  downpayment_value numeric(14,2);
  balance_payment_method_value text;
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
  if sale_row.status not in ('held', 'quotation') then
    raise exception 'Only a held sale or quotation can be completed this way';
  end if;

  for line_record in select * from public.sale_lines where public.sale_lines.sale_id = target_sale_id and variant_id is not null loop
    if line_record.location_id is null then
      raise exception 'A sale line is missing its storage location and cannot be completed';
    end if;
    txn_lines := txn_lines || jsonb_build_object(
      'variantId', line_record.variant_id,
      'locationId', line_record.location_id,
      'quantityDelta', -line_record.quantity
    );
  end loop;

  if jsonb_array_length(txn_lines) > 0 then
    inventory_txn_id := public.post_inventory_transaction(jsonb_build_object(
      'type', 'sale',
      'actorId', actor_id,
      'reason', 'Reservation completed',
      'lines', txn_lines
    ));
  end if;

  balance_paid_value := coalesce(nullif(p_sale->>'balancePaidAt', '')::timestamptz, now());
  downpayment_value := nullif(p_sale->>'downpaymentAmount', '')::numeric;
  balance_payment_method_value := nullif(p_sale->>'balancePaymentMethod', '');

  update public.sales
  set status = 'completed',
      inventory_transaction_id = inventory_txn_id,
      completed_by = actor_id,
      completed_at = now(),
      balance_paid_at = balance_paid_value,
      balance_payment_method = coalesce(balance_payment_method_value, balance_payment_method),
      downpayment_amount = coalesce(downpayment_value, downpayment_amount)
  where id = target_sale_id;

  insert into public.sale_events (sale_id, action, actor_id) values (target_sale_id, 'completed', actor_id);

  return jsonb_build_object('id', target_sale_id, 'status', 'completed', 'inventoryTransactionId', inventory_txn_id);
end;
$$;

revoke all on function public.complete_sale(jsonb) from public, anon, authenticated;
grant execute on function public.complete_sale(jsonb) to authenticated, service_role;

create or replace function public.cancel_sale(p_sale jsonb)
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
  reversal_id uuid;
  reversal_lines jsonb;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager') then raise exception 'Only an owner or manager can cancel a sale'; end if;

  target_sale_id := (p_sale->>'saleId')::uuid;
  select * into sale_row from public.sales where id = target_sale_id;
  if not found then raise exception 'Sale not found'; end if;
  if sale_row.status = 'cancelled' then raise exception 'Sale is already cancelled'; end if;

  if sale_row.status = 'completed' and sale_row.inventory_transaction_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'variantId', line.variant_id,
      'locationId', line.location_id,
      'quantityDelta', -line.quantity_delta
    )), '[]'::jsonb) into reversal_lines
    from public.inventory_transaction_lines line
    where line.transaction_id = sale_row.inventory_transaction_id;

    reversal_id := public.post_inventory_transaction(jsonb_build_object(
      'type', 'reversal',
      'actorId', actor_id,
      'reversesTransactionId', sale_row.inventory_transaction_id,
      'reason', 'Sale cancelled',
      'lines', reversal_lines
    ));
  end if;

  update public.sales set status = 'cancelled', cancelled_by = actor_id, cancelled_at = now() where id = target_sale_id;

  insert into public.sale_events (sale_id, action, actor_id) values (target_sale_id, 'cancelled', actor_id);

  return jsonb_build_object('id', target_sale_id, 'status', 'cancelled', 'reversalTransactionId', reversal_id);
end;
$$;

revoke all on function public.cancel_sale(jsonb) from public, anon, authenticated;
grant execute on function public.cancel_sale(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. sales_overview: append who-made-it / who-completed-it / who-cancelled-it
--    names, and enrich each line item with the catalogue product name and
--    SKU (so the Transactions page can show a full order detail without a
--    second round trip). Existing column order preserved, everything new
--    appended at the end (CREATE OR REPLACE VIEW cannot reorder columns).
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
  canceller.full_name as cancelled_by_name
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
left join public.product_variants variant on variant.id = line.variant_id
left join public.products product on product.id = variant.product_id
left join public.profiles creator on creator.id = sale.created_by
left join public.profiles completer on completer.id = sale.completed_by
left join public.profiles canceller on canceller.id = sale.cancelled_by
group by sale.id, creator.full_name, completer.full_name, canceller.full_name;

grant select on public.sales_overview to authenticated;

-- ---------------------------------------------------------------------------
-- 6. sale_history: the per-sale edit/action log, with the actor's name
--    already joined in, ready to list on the Transactions page.
-- ---------------------------------------------------------------------------
create or replace view public.sale_history
with (security_invoker = true)
as
select
  event.id,
  event.sale_id,
  event.action,
  event.actor_id,
  actor.full_name as actor_name,
  event.note,
  event.created_at
from public.sale_events event
left join public.profiles actor on actor.id = event.actor_id
order by event.created_at asc;

grant select on public.sale_history to authenticated;

-- Backfill a "created" event for every sale that already exists, so history
-- isn't empty for transactions made before this migration.
insert into public.sale_events (sale_id, action, actor_id, created_at)
select
  sale.id,
  case sale.status
    when 'held' then 'created_held'
    when 'quotation' then 'created_quotation'
    else 'created_completed'
  end,
  sale.created_by,
  sale.created_at
from public.sales sale
where not exists (select 1 from public.sale_events event where event.sale_id = sale.id);

insert into public.sale_events (sale_id, action, actor_id, created_at)
select sale.id, 'cancelled', sale.cancelled_by, coalesce(sale.cancelled_at, sale.created_at)
from public.sales sale
where sale.status = 'cancelled'
  and not exists (select 1 from public.sale_events event where event.sale_id = sale.id and event.action = 'cancelled');

commit;
