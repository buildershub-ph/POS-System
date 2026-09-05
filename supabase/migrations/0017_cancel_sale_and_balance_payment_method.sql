begin;

-- Re-creates cancel_sale, which was only ever defined in migration 0011 and
-- never re-created since (unlike create_sale/complete_sale/sales_overview,
-- which every later migration redefines). If 0011 was skipped or its
-- transaction never committed, this function would be entirely missing --
-- PostgREST would report "Could not find the function public.cancel_sale
-- (p_sale) in the schema cache". This file is safe to run regardless of
-- whether 0011 succeeded (CREATE OR REPLACE either way).
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

  update public.sales set status = 'cancelled' where id = target_sale_id;

  return jsonb_build_object('id', target_sale_id, 'status', 'cancelled', 'reversalTransactionId', reversal_id);
end;
$$;

revoke all on function public.cancel_sale(jsonb) from public, anon, authenticated;
grant execute on function public.cancel_sale(jsonb) to authenticated, service_role;

-- A reservation's downpayment and its balance settlement can use different
-- payment methods (e.g. GCash downpayment, cash on pickup) -- track them
-- separately.
alter table public.sales
  add column if not exists balance_payment_method text
  check (balance_payment_method in ('cash','gcash','maya','bank_transfer','card','split'));

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

  return jsonb_build_object('id', target_sale_id, 'status', 'completed', 'inventoryTransactionId', inventory_txn_id);
end;
$$;

-- Existing column order preserved, balance_payment_method appended at the end.
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
    'discountReason', line.discount_reason
  ) order by line.id) filter (where line.id is not null), '[]'::jsonb) as line_items,
  sale.customer_contact_number,
  sale.downpayment_amount,
  sale.balance_paid_at,
  greatest(coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.downpayment_amount, 0)::numeric(14,2) as balance_due,
  sale.balance_payment_method
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
group by sale.id;

grant select on public.sales_overview to authenticated;

commit;
