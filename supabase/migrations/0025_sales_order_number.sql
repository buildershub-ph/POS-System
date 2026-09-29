begin;

-- ---------------------------------------------------------------------------
-- The store still writes a paper receipt, whose pre-printed Sales Order (SO)
-- number differs from the POS invoice number. This lets staff record that SO
-- number against a sale, typed in by hand from the Transactions page, so the
-- two can be matched up. Optional, editable (to fix a typo), and unique so
-- the same receipt can't be attached to two sales by mistake.
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists sales_order_number text;

create unique index if not exists sales_sales_order_number_unique
  on public.sales (lower(sales_order_number))
  where sales_order_number is not null;

alter table public.sale_events drop constraint if exists sale_events_action_check;
alter table public.sale_events add constraint sale_events_action_check
  check (action in ('created_held', 'created_quotation', 'created_completed', 'completed', 'cancelled', 'payment_recorded', 'sales_order_number_set'));

create or replace function public.set_sales_order_number(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  target_sale_id uuid;
  so_value text;
  clash_number bigint;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager', 'sales_employee', 'cashier') then
    raise exception 'Role cannot process sales';
  end if;

  target_sale_id := (p_sale->>'saleId')::uuid;
  if not exists (select 1 from public.sales where id = target_sale_id) then raise exception 'Sale not found'; end if;

  -- Blank clears it.
  so_value := nullif(trim(p_sale->>'salesOrderNumber'), '');
  if so_value is not null then
    select sale_number into clash_number from public.sales
    where lower(sales_order_number) = lower(so_value) and id <> target_sale_id;
    if found then
      raise exception 'SO number % is already on invoice INV-%', so_value, lpad(clash_number::text, greatest(4, length(clash_number::text)), '0');
    end if;
  end if;

  update public.sales set sales_order_number = so_value where id = target_sale_id;

  insert into public.sale_events (sale_id, action, actor_id, note)
  values (target_sale_id, 'sales_order_number_set', actor_id, coalesce(so_value, 'cleared'));

  return jsonb_build_object('id', target_sale_id, 'salesOrderNumber', so_value);
end;
$$;

revoke all on function public.set_sales_order_number(jsonb) from public, anon, authenticated;
grant execute on function public.set_sales_order_number(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sales_overview: identical to migration 0023's, plus sales_order_number
-- appended at the end. Existing column order preserved.
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
  greatest(coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.total_discount_amount, 0)::numeric(14,2) as net_total_amount,
  sale.sales_order_number
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
