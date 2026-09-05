begin;

-- Fixes "column reference sale_id is ambiguous": the function's local
-- variable was named the same as sale_lines.sale_id. Renamed the variable
-- and qualified the table reference so there's no ambiguity either way.
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

  update public.sales
  set status = 'completed',
      inventory_transaction_id = inventory_txn_id,
      completed_by = actor_id,
      completed_at = now(),
      balance_paid_at = balance_paid_value,
      downpayment_amount = coalesce(downpayment_value, downpayment_amount)
  where id = target_sale_id;

  return jsonb_build_object('id', target_sale_id, 'status', 'completed', 'inventoryTransactionId', inventory_txn_id);
end;
$$;

commit;
