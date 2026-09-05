begin;

create or replace function public.post_inventory_transaction(p_transaction jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
<<inventory_post>>
declare
  actor_id uuid;
  actor_role public.user_role;
  transaction_type public.inventory_transaction_type;
  transaction_id uuid;
  line jsonb;
  line_variant uuid;
  line_location uuid;
  line_delta numeric(14,3);
  original_id uuid;
  current_balance numeric(14,3);
begin
  actor_id := coalesce(nullif(p_transaction->>'actorId','')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  transaction_type := (p_transaction->>'type')::public.inventory_transaction_type;

  if actor_role is null then raise exception 'Unauthorised'; end if;
  if transaction_type in ('receiving','transfer','supplier_return','damaged','display_stock','physical_count_adjustment')
     and actor_role not in ('owner','manager','stock_employee') then raise exception 'Role cannot post this inventory transaction'; end if;
  if transaction_type = 'sale' and actor_role not in ('owner','manager','sales_employee','cashier') then raise exception 'Role cannot post sales'; end if;
  if transaction_type = 'reversal' and actor_role not in ('owner','manager') then raise exception 'Only an owner or manager can reverse stock'; end if;

  original_id := nullif(p_transaction->>'reversesTransactionId','')::uuid;
  if transaction_type = 'reversal' and original_id is null then raise exception 'Reversal requires the original transaction'; end if;
  if jsonb_array_length(coalesce(p_transaction->'lines','[]'::jsonb)) = 0 then raise exception 'Transaction requires lines'; end if;

  insert into public.inventory_transactions(
    transaction_type, status, source_location_id, destination_location_id,
    reverses_transaction_id, reason, notes, created_by
  ) values (
    transaction_type, 'draft', nullif(p_transaction->>'sourceLocationId','')::uuid,
    nullif(p_transaction->>'destinationLocationId','')::uuid, original_id,
    p_transaction->>'reason', p_transaction->>'notes', actor_id
  ) returning id into transaction_id;

  for line in select value from jsonb_array_elements(p_transaction->'lines') loop
    line_variant := (line->>'variantId')::uuid;
    line_location := (line->>'locationId')::uuid;
    line_delta := (line->>'quantityDelta')::numeric;
    if line_delta = 0 then raise exception 'Ledger quantities cannot be zero'; end if;
    if transaction_type = 'receiving' and line_delta < 0 then raise exception 'Receiving cannot reduce stock'; end if;
    if transaction_type in ('sale','supplier_return','damaged') and line_delta > 0 then raise exception '% cannot increase stock', transaction_type; end if;
    insert into public.inventory_transaction_lines(transaction_id, variant_id, location_id, quantity_delta)
    values (transaction_id, line_variant, line_location, line_delta);
  end loop;

  if transaction_type = 'transfer' and exists (
    select 1 from public.inventory_transaction_lines
    where inventory_transaction_lines.transaction_id = inventory_post.transaction_id
    group by variant_id having sum(quantity_delta) <> 0
  ) then raise exception 'Each transferred variant must net to zero'; end if;

  if transaction_type not in ('receiving','customer_return','physical_count_adjustment','reversal') then
    for line_variant, line_location in
      select variant_id, location_id from public.inventory_transaction_lines
      where inventory_transaction_lines.transaction_id = inventory_post.transaction_id
      group by variant_id, location_id
    loop
      select coalesce(sum(balance.available_quantity),0) into current_balance
      from public.inventory_balances balance
      where balance.variant_id = line_variant and balance.location_id = line_location;
      select current_balance + sum(quantity_delta) into current_balance
      from public.inventory_transaction_lines
      where inventory_transaction_lines.transaction_id = inventory_post.transaction_id
        and variant_id = line_variant and location_id = line_location;
      if current_balance < 0 then raise exception 'Insufficient stock for variant % at location %', line_variant, line_location; end if;
    end loop;
  end if;

  perform set_config('app.allow_posted_mutation','on',true);
  update public.inventory_transactions set status = 'posted', posted_by = actor_id, posted_at = now()
  where id = transaction_id;
  if transaction_type = 'reversal' then
    update public.inventory_transactions set status = 'reversed' where id = original_id and status = 'posted';
    if not found then raise exception 'Original transaction is not eligible for reversal'; end if;
  end if;
  perform set_config('app.allow_posted_mutation','off',true);
  return transaction_id;
exception when others then
  perform set_config('app.allow_posted_mutation','off',true);
  raise;
end inventory_post;
$$;

create or replace function public.update_variant_photo(
  p_variant_id uuid,
  p_photo_path text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := coalesce(p_actor_id, auth.uid());
  actor_role public.user_role;
begin
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role not in ('owner','manager','stock_employee') then
    raise exception 'Role cannot update product photographs';
  end if;
  if nullif(trim(p_photo_path), '') is null then raise exception 'Photo path is required'; end if;

  update public.product_variants
  set photo_path = trim(p_photo_path), updated_at = now()
  where id = p_variant_id and active = true;
  if not found then raise exception 'Product variant not found'; end if;

  insert into public.audit_log(user_id, event_type, entity_table, entity_id, metadata)
  values (actor_id, 'update_product_photo', 'product_variants', p_variant_id::text, jsonb_build_object('photo_path', p_photo_path));
end;
$$;

revoke all on function public.update_variant_photo(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.update_variant_photo(uuid, text, uuid) to authenticated, service_role;

create policy product_photos_stock_team_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-photos'
  and public.has_role(array['owner','manager','stock_employee']::public.user_role[])
);

commit;
