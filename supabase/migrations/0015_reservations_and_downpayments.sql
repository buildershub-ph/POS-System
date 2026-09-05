begin;

-- Held sales (reservations) can carry a downpayment. Sale lines now record
-- their location even when held, so the reservation can later be completed
-- (posting the inventory transaction at that point) without re-entering
-- where the stock comes from.
alter table public.sales
  add column if not exists downpayment_amount numeric(14,2) not null default 0 check (downpayment_amount >= 0),
  add column if not exists balance_paid_at timestamptz;

alter table public.sale_lines
  add column if not exists location_id uuid references public.locations(id) on delete restrict;

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
  line_custom_name text;
  line_custom_sku text;
  needs_approval boolean;
  txn_lines jsonb;
  sale_row public.sales;
  customer_name_value text;
  downpayment_value numeric(14,2);
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

  customer_name_value := nullif(trim(p_sale->>'customerName'), '');
  if customer_name_value is null then
    raise exception 'Customer full name is required';
  end if;

  downpayment_value := greatest(coalesce(nullif(p_sale->>'downpaymentAmount', '')::numeric, 0), 0);

  if sale_status = 'completed' then
    txn_lines := '[]'::jsonb;
    for line in select value from jsonb_array_elements(p_sale->'lines') loop
      if nullif(line->>'variantId', '') is not null then
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
    inventory_transaction_id, downpayment_amount, created_by, completed_by, completed_at
  ) values (
    sale_uuid, sale_status, customer_name_value, nullif(trim(p_sale->>'customerContactNumber'), ''),
    nullif(p_sale->>'fulfilmentMethod', ''), nullif(p_sale->>'paymentMethod', ''),
    nullif(trim(p_sale->>'notes'), ''), inventory_txn_id, downpayment_value, actor_id,
    case when sale_status = 'completed' then actor_id end,
    case when sale_status = 'completed' then now() end
  ) returning * into sale_row;

  for line in select value from jsonb_array_elements(p_sale->'lines') loop
    line_variant := nullif(line->>'variantId', '')::uuid;
    line_location := nullif(line->>'locationId', '')::uuid;
    line_custom_name := nullif(trim(line->>'customItemName'), '');
    line_custom_sku := nullif(trim(line->>'customSku'), '');
    if line_variant is null and line_custom_name is null then
      raise exception 'Every sale line needs either a catalogue product or a custom item name';
    end if;
    if line_variant is not null and line_location is null then
      raise exception 'Every catalogue sale line needs a storage location';
    end if;
    line_quantity := (line->>'quantity')::numeric;
    line_unit := coalesce(nullif(line->>'sellingUnit', '')::public.selling_unit, 'piece');
    line_srp := greatest(coalesce(nullif(line->>'originalSrp', '')::numeric, 0), 0);
    line_price := greatest(coalesce(nullif(line->>'actualSellingPrice', '')::numeric, 0), 0);
    line_discount_reason := nullif(trim(line->>'discountReason'), '');
    if line_quantity <= 0 then raise exception 'Sale line quantity must be greater than zero'; end if;

    needs_approval := line_variant is not null and line_price < line_srp and not can_approve;

    insert into public.sale_lines (
      sale_id, variant_id, location_id, custom_item_name, custom_sku, quantity, selling_unit,
      original_srp, actual_selling_price, discount_reason, approval_required,
      approved_by, approved_at
    ) values (
      sale_uuid, line_variant, line_location, line_custom_name, line_custom_sku, line_quantity, line_unit,
      line_srp, line_price, line_discount_reason, needs_approval,
      case when line_variant is not null and line_price < line_srp and can_approve then actor_id end,
      case when line_variant is not null and line_price < line_srp and can_approve then now() end
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

-- Completes a held sale or quotation -- a reservation the customer is now
-- picking up and paying the balance on. Posts the inventory transaction at
-- this point (stock was never touched while merely held) and records when
-- the balance was paid.
create or replace function public.complete_sale(p_sale jsonb)
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
  txn_lines jsonb := '[]'::jsonb;
  inventory_txn_id uuid;
  line_record record;
  balance_paid_value timestamptz;
  downpayment_value numeric(14,2);
begin
  actor_id := coalesce(nullif(p_sale->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role is null then raise exception 'Unauthorised'; end if;
  if actor_role not in ('owner', 'manager', 'sales_employee', 'cashier') then
    raise exception 'Role cannot process sales';
  end if;

  sale_id := (p_sale->>'saleId')::uuid;
  select * into sale_row from public.sales where id = sale_id;
  if not found then raise exception 'Sale not found'; end if;
  if sale_row.status not in ('held', 'quotation') then
    raise exception 'Only a held sale or quotation can be completed this way';
  end if;

  for line_record in select * from public.sale_lines where sale_id = sale_row.id and variant_id is not null loop
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
  where id = sale_row.id;

  return jsonb_build_object('id', sale_row.id, 'status', 'completed', 'inventoryTransactionId', inventory_txn_id);
end;
$$;

revoke all on function public.complete_sale(jsonb) from public, anon, authenticated;
grant execute on function public.complete_sale(jsonb) to authenticated, service_role;

-- Existing column order preserved, new columns appended at the end.
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
  greatest(coalesce(sum(line.quantity * line.actual_selling_price), 0) - sale.downpayment_amount, 0)::numeric(14,2) as balance_due
from public.sales sale
left join public.sale_lines line on line.sale_id = sale.id
group by sale.id;

grant select on public.sales_overview to authenticated;

commit;
