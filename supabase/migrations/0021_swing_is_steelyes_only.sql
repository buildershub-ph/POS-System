begin;

-- ---------------------------------------------------------------------------
-- Correction: the left/right swing choice only applies to Steelyes doors,
-- not every Filhome Builders door (JBosch doors don't need it). Re-create
-- create_sale identical to migration 0020's version, but check the
-- product's brand instead of its supplier/category.
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

commit;
