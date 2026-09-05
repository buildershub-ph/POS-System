begin;

alter table public.products add column if not exists sheet_product_id text;
alter table public.product_variants add column if not exists sheet_variant_id text;
alter table public.purchase_charges add column if not exists sheet_charge_id text;

update public.products
set sheet_product_id = 'PROD-' || lpad((right(id::text, 12)::bigint)::text, 3, '0')
where sheet_product_id is null and id::text like '40000000-%';

update public.product_variants
set sheet_variant_id = 'VAR-' || lpad((right(id::text, 12)::bigint)::text, 3, '0')
where sheet_variant_id is null and id::text like '50000000-%';

update public.purchase_charges
set sheet_charge_id = 'CHG-' || lpad((right(id::text, 12)::bigint)::text, 3, '0')
where sheet_charge_id is null and id::text like '90000000-%';

create unique index if not exists products_sheet_product_id_unique on public.products(sheet_product_id) where sheet_product_id is not null;
create unique index if not exists variants_sheet_variant_id_unique on public.product_variants(sheet_variant_id) where sheet_variant_id is not null;
create unique index if not exists charges_sheet_charge_id_unique on public.purchase_charges(sheet_charge_id) where sheet_charge_id is not null;

create or replace view public.portal_catalogue
with (security_invoker = true)
as
select
  catalogue.*,
  coalesce(incoming.incoming_quantity, 0)::numeric(14,3) as incoming_quantity,
  incoming.source_invoice,
  incoming.delivery_reference,
  incoming.delivery_date
from public.catalogue_variants catalogue
left join lateral (
  select
    sum(line.quantity_delta) as incoming_quantity,
    max(transaction.reference_number) as source_invoice,
    max(transaction.delivery_reference) as delivery_reference,
    max(transaction.created_at::date) as delivery_date
  from public.inventory_transaction_lines line
  join public.inventory_transactions transaction on transaction.id = line.transaction_id
  where line.variant_id = catalogue.id
    and transaction.transaction_type = 'receiving'
    and transaction.status = 'draft'
) incoming on true;

grant select on public.portal_catalogue to authenticated;

create or replace function public.apply_sheet_edit(
  p_sheet text,
  p_row jsonb,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  category_uuid uuid;
  product_uuid uuid;
  variant_uuid uuid;
  invoice_uuid uuid;
  landed numeric(14,4);
  unit_cost_value numeric(14,4);
begin
  select * into actor
  from public.profiles
  where lower(email) = lower(p_actor_email) and active = true;

  if actor.id is null or actor.role <> 'owner' then
    raise exception 'Only an active owner may sync spreadsheet edits';
  end if;

  case lower(p_sheet)
    when 'products' then
      select id into category_uuid from public.categories where code = p_row->>'CategoryCode' and active = true;
      if category_uuid is null then raise exception 'Unknown category code'; end if;

      update public.products
      set category_id = category_uuid,
          brand = coalesce(nullif(p_row->>'Brand', ''), brand),
          model = coalesce(nullif(p_row->>'Model', ''), model),
          name = coalesce(nullif(p_row->>'ProductName', ''), name),
          description = nullif(p_row->>'Description', ''),
          main_photo_path = nullif(p_row->>'PrimaryPhoto', ''),
          active = coalesce(nullif(p_row->>'Active', '')::boolean, active),
          updated_at = now()
      where sheet_product_id = p_row->>'ProductID';

    when 'variants' then
      select id into product_uuid from public.products where sheet_product_id = p_row->>'ProductID';
      if product_uuid is null then raise exception 'Unknown ProductID'; end if;

      update public.product_variants
      set product_id = product_uuid,
          sku = coalesce(nullif(p_row->>'SKU', ''), sku),
          barcode = coalesce(nullif(p_row->>'Barcode', ''), barcode),
          attributes = jsonb_strip_nulls(jsonb_build_object(
            'Variant name', nullif(p_row->>'VariantName', ''),
            'Size', nullif(p_row->>'Size', ''),
            'Color', nullif(p_row->>'Color', ''),
            'Finish', nullif(p_row->>'Finish', ''),
            'Supplier barcode', nullif(p_row->>'SupplierBarcode', '')
          )),
          selling_unit = case lower(coalesce(p_row->>'Unit', 'pc'))
            when 'box' then 'box'::public.selling_unit
            when 'set' then 'set'::public.selling_unit
            when 'pair' then 'pair'::public.selling_unit
            when 'sqm' then 'square_metre'::public.selling_unit
            when 'lm' then 'linear_metre'::public.selling_unit
            else 'piece'::public.selling_unit
          end,
          srp = coalesce(nullif(p_row->>'SRP', '')::numeric, 0),
          reorder_level = coalesce(nullif(p_row->>'ReorderLevel', '')::numeric, 0),
          active = coalesce(nullif(p_row->>'Active', '')::boolean, active),
          updated_at = now()
      where sku = p_row->>'SKU' or sheet_variant_id = p_row->>'VariantID';

    when 'locations' then
      update public.locations
      set name = coalesce(nullif(p_row->>'LocationName', ''), name),
          address = nullif(p_row->>'Address', ''),
          active = coalesce(nullif(p_row->>'Active', '')::boolean, active)
      where code = p_row->>'LocationID';

    when 'privatecosts' then
      select id into variant_uuid from public.product_variants where sku = p_row->>'SKU';
      if variant_uuid is null then raise exception 'Unknown SKU'; end if;
      unit_cost_value := coalesce(nullif(p_row->>'NetUnitPurchaseCost', '')::numeric, nullif(p_row->>'GrossUnitPrice', '')::numeric, 0);
      landed := coalesce(nullif(p_row->>'LandedCost', '')::numeric, unit_cost_value);

      update public.variant_private_costs
      set unit_cost = unit_cost_value,
          landed_cost = landed,
          minimum_selling_price = greatest(minimum_selling_price, landed),
          effective_at = coalesce(nullif(p_row->>'EffectiveDate', '')::timestamptz, effective_at),
          updated_by = actor.id,
          updated_at = now()
      where variant_id = variant_uuid;

    when 'purchaseinvoices' then
      update public.purchase_invoices
      set delivery_reference = nullif(p_row->>'DeliveryReference', ''),
          source_order = nullif(p_row->>'SourceOrder', ''),
          document_type = coalesce(nullif(p_row->>'DocumentType', ''), document_type),
          merchandise_amount = coalesce(nullif(p_row->>'Merchandise', '')::numeric, merchandise_amount),
          packaging_amount = coalesce(nullif(p_row->>'Packaging', '')::numeric, packaging_amount),
          invoice_total = coalesce(nullif(p_row->>'InvoiceTotal', '')::numeric, invoice_total),
          receipt_status = lower(coalesce(nullif(p_row->>'ReceiptStatus', ''), receipt_status)),
          review_note = nullif(p_row->>'ReviewNote', ''),
          updated_at = now()
      where invoice_number = p_row->>'InvoiceNo';

    when 'purchasecharges' then
      select id into invoice_uuid from public.purchase_invoices where invoice_number = p_row->>'InvoiceNo';
      if invoice_uuid is null then raise exception 'Unknown invoice'; end if;

      update public.purchase_charges
      set invoice_id = invoice_uuid,
          charge_type = coalesce(nullif(p_row->>'ChargeType', ''), charge_type),
          supplier_item_code = nullif(p_row->>'SupplierItemCode', ''),
          quantity = coalesce(nullif(p_row->>'Quantity', '')::numeric, quantity),
          unit_cost = coalesce(nullif(p_row->>'UnitCost', '')::numeric, unit_cost),
          amount = coalesce(nullif(p_row->>'Amount', '')::numeric, amount),
          allocation_status = coalesce(nullif(p_row->>'AllocationStatus', ''), allocation_status),
          notes = nullif(p_row->>'Notes', '')
      where sheet_charge_id = p_row->>'ChargeID';

    else
      raise exception 'This sheet is read-only. Inventory balances change only through portal transactions.';
  end case;

  if not found then raise exception 'No matching database record'; end if;

  insert into public.audit_log(user_id, event_type, entity_table, entity_id, metadata)
  values (actor.id, 'sheet_edit', p_sheet, coalesce(p_row->>'SKU', p_row->>'ProductID', p_row->>'InvoiceNo', p_row->>'ChargeID', p_row->>'LocationID'), jsonb_build_object('source', 'google_sheets'));

  return jsonb_build_object('ok', true, 'sheet', p_sheet);
end;
$$;

revoke all on function public.apply_sheet_edit(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_sheet_edit(text, jsonb, text) to service_role;

create or replace function public.post_inventory_transaction(p_transaction jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    where inventory_transaction_lines.transaction_id = post_inventory_transaction.transaction_id
    group by variant_id having sum(quantity_delta) <> 0
  ) then raise exception 'Each transferred variant must net to zero'; end if;

  if transaction_type not in ('receiving','customer_return','physical_count_adjustment','reversal') then
    for line_variant, line_location in
      select variant_id, location_id from public.inventory_transaction_lines
      where inventory_transaction_lines.transaction_id = post_inventory_transaction.transaction_id
      group by variant_id, location_id
    loop
      select coalesce(sum(balance.available_quantity),0) into current_balance
      from public.inventory_balances balance
      where balance.variant_id = line_variant and balance.location_id = line_location;
      select current_balance + sum(quantity_delta) into current_balance
      from public.inventory_transaction_lines
      where inventory_transaction_lines.transaction_id = post_inventory_transaction.transaction_id
        and variant_id = line_variant and location_id = line_location;
      if current_balance < 0 then raise exception 'Insufficient stock for variant % at location %', line_variant, line_location; end if;
    end loop;
  end if;

  perform set_config('app.allow_posted_mutation','on',true);
  update public.inventory_transactions set status = 'posted', posted_by = actor_id, posted_at = now() where id = transaction_id;
  if transaction_type = 'reversal' then
    update public.inventory_transactions set status = 'reversed' where id = original_id and status = 'posted';
    if not found then raise exception 'Original transaction is not eligible for reversal'; end if;
  end if;
  perform set_config('app.allow_posted_mutation','off',true);
  return transaction_id;
exception when others then
  perform set_config('app.allow_posted_mutation','off',true);
  raise;
end;
$$;

commit;
