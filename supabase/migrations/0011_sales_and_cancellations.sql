begin;

-- Posts a point-of-sale transaction. "held"/"quotation" sales are recorded
-- without touching stock (nothing has left the shelf yet); "completed" sales
-- post a single inventory 'sale' transaction (which itself checks that stock
-- is sufficient) and link the sale to it, so it can later be reversed.
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
  needs_approval boolean;
  txn_lines jsonb;
  sale_row public.sales;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager', 'sales_employee', 'cashier') then
    raise exception 'Role cannot process sales';
  end if;
  can_approve := actor_role in ('owner', 'manager');

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
      txn_lines := txn_lines || jsonb_build_object(
        'variantId', line->>'variantId',
        'locationId', line->>'locationId',
        'quantityDelta', -((line->>'quantity')::numeric)
      );
    end loop;
    inventory_txn_id := public.post_inventory_transaction(jsonb_build_object(
      'type', 'sale',
      'actorId', actor_id,
      'reason', 'Point of sale',
      'lines', txn_lines
    ));
  end if;

  insert into public.sales (
    id, status, customer_name, fulfilment_method, payment_method, notes,
    inventory_transaction_id, created_by, completed_by, completed_at
  ) values (
    sale_uuid, sale_status, nullif(trim(p_sale->>'customerName'), ''),
    nullif(p_sale->>'fulfilmentMethod', ''), nullif(p_sale->>'paymentMethod', ''),
    nullif(trim(p_sale->>'notes'), ''), inventory_txn_id, actor_id,
    case when sale_status = 'completed' then actor_id end,
    case when sale_status = 'completed' then now() end
  ) returning * into sale_row;

  for line in select value from jsonb_array_elements(p_sale->'lines') loop
    line_variant := (line->>'variantId')::uuid;
    line_location := (line->>'locationId')::uuid;
    line_quantity := (line->>'quantity')::numeric;
    line_unit := coalesce(nullif(line->>'sellingUnit', '')::public.selling_unit, 'piece');
    line_srp := greatest(coalesce(nullif(line->>'originalSrp', '')::numeric, 0), 0);
    line_price := greatest(coalesce(nullif(line->>'actualSellingPrice', '')::numeric, 0), 0);
    line_discount_reason := nullif(trim(line->>'discountReason'), '');
    if line_quantity <= 0 then raise exception 'Sale line quantity must be greater than zero'; end if;

    needs_approval := line_price < line_srp and not can_approve;

    insert into public.sale_lines (
      sale_id, variant_id, quantity, selling_unit, original_srp, actual_selling_price,
      discount_reason, approval_required, approved_by, approved_at
    ) values (
      sale_uuid, line_variant, line_quantity, line_unit, line_srp, line_price,
      line_discount_reason, needs_approval,
      case when line_price < line_srp and can_approve then actor_id end,
      case when line_price < line_srp and can_approve then now() end
    );
  end loop;

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

-- Cancels a sale. A held/quotation sale never touched stock, so cancelling it
-- is just a status change. A completed sale posts a 'reversal' inventory
-- transaction that inverts every line of the original sale, returning the
-- stock -- only an owner or manager can do this (same rule as any other
-- stock-reversing action).
create or replace function public.cancel_sale(p_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  sale_id uuid;
  sale_row public.sales;
  reversal_id uuid;
  reversal_lines jsonb;
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager') then raise exception 'Only an owner or manager can cancel a sale'; end if;

  sale_id := (p_sale->>'saleId')::uuid;
  select * into sale_row from public.sales where id = sale_id;
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

  update public.sales set status = 'cancelled' where id = sale_id;

  return jsonb_build_object('id', sale_id, 'status', 'cancelled', 'reversalTransactionId', reversal_id);
end;
$$;

revoke all on function public.cancel_sale(jsonb) from public, anon, authenticated;
grant execute on function public.cancel_sale(jsonb) to authenticated, service_role;

-- Read-friendly view for the Transactions page: one row per sale, with its
-- line items folded into a JSON array and simple totals precomputed.
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
    'quantity', line.quantity,
    'sellingUnit', line.selling_unit,
    'originalSrp', line.original_srp,
    'actualSellingPrice', line.actual_selling_price,
    'discountReason', line.discount_reason
  ) order by line.id) filter (where line.id is not null), '[]'::jsonb) as line_items
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
group by sale.id;

grant select on public.sales_overview to authenticated;

commit;
