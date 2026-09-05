begin;

-- Some retail items are kept on the floor for display only and are not physically
-- stocked — customers can still order them, staff just need to know to say
-- "available by order only" instead of handing over stock on the spot.
create type public.variant_availability as enum ('stocked', 'display_only');

alter table public.product_variants
  add column if not exists availability public.variant_availability not null default 'stocked';

-- Builder's Hub (the main store) also has a sister company that keeps stock of
-- some of the same items at its own sites. Locations now record which company
-- owns the stock sitting there, so reporting and transfers can tell them apart.
alter table public.locations
  add column if not exists company text not null default 'Builders Hub';

update public.locations set company = 'Builders Hub' where company is null;

insert into public.locations (id, code, name, address, company) values
  ('20000000-0000-0000-0000-000000000004', 'CANLALAY', 'Canlalay Branch', 'Sister company branch', 'Sister Company'),
  ('20000000-0000-0000-0000-000000000005', 'KOSCH-WH', 'Kosch Warehouse', 'Sister company warehouse', 'Sister Company')
on conflict (id) do update set code = excluded.code, name = excluded.name, address = excluded.address, company = excluded.company, active = true;

-- Column order below must exactly match the prior definition of this view up
-- to "supplier_name" (Postgres cannot reorder or insert into the middle of an
-- existing view's columns via CREATE OR REPLACE — only append at the end).
create or replace view public.catalogue_variants
with (security_invoker = true)
as
select
  variant.id,
  product.id as product_id,
  product.name as product_name,
  category.name as category,
  product.brand,
  product.model,
  variant.sku,
  variant.barcode,
  variant.attributes,
  variant.selling_unit,
  variant.srp,
  variant.reorder_level,
  coalesce(sum(balance.available_quantity), 0)::numeric(14,3) as available_quantity,
  variant.default_location_id,
  location.name as default_location,
  coalesce(variant.photo_path, product.main_photo_path) as photo_path,
  variant.pieces_per_box,
  variant.sqm_per_box,
  variant.active,
  variant.supplier_sku,
  variant.supplier_id,
  supplier.name as supplier_name,
  location.company as default_location_company,
  variant.availability
from public.product_variants variant
join public.products product on product.id = variant.product_id
join public.categories category on category.id = product.category_id
left join public.inventory_balances balance on balance.variant_id = variant.id
left join public.locations location on location.id = variant.default_location_id
left join public.suppliers supplier on supplier.id = variant.supplier_id
where product.active = true
group by variant.id, product.id, category.id, location.id, supplier.id;

-- Same rule as above: existing columns keep their exact order, new ones go last.
create or replace view public.portal_catalogue
with (security_invoker = true)
as
select
  catalogue.id,
  catalogue.product_id,
  catalogue.product_name,
  catalogue.category,
  catalogue.brand,
  catalogue.model,
  catalogue.sku,
  catalogue.barcode,
  catalogue.attributes,
  catalogue.selling_unit,
  catalogue.srp,
  catalogue.reorder_level,
  catalogue.available_quantity,
  catalogue.default_location_id,
  catalogue.default_location,
  catalogue.photo_path,
  catalogue.pieces_per_box,
  catalogue.sqm_per_box,
  catalogue.active,
  coalesce(incoming.incoming_quantity, 0)::numeric(14,3) as incoming_quantity,
  incoming.source_invoice,
  incoming.delivery_reference,
  incoming.delivery_date,
  incoming.draft_transaction_id,
  catalogue.supplier_sku,
  catalogue.supplier_id,
  catalogue.supplier_name,
  catalogue.default_location_company,
  catalogue.availability
from public.catalogue_variants catalogue
left join lateral (
  select
    sum(line.quantity_delta) as incoming_quantity,
    max(transaction.reference_number) as source_invoice,
    max(transaction.delivery_reference) as delivery_reference,
    max(transaction.created_at::date) as delivery_date,
    (array_agg(transaction.id order by transaction.created_at desc))[1] as draft_transaction_id
  from public.inventory_transaction_lines line
  join public.inventory_transactions transaction on transaction.id = line.transaction_id
  where line.variant_id = catalogue.id
    and transaction.transaction_type = 'receiving'
    and transaction.status = 'draft'
) incoming on true;

create or replace view public.inventory_export
with (security_invoker = true)
as
select sku, barcode, product_name, category, brand, model, attributes, selling_unit,
       srp as selling_price, available_quantity, default_location as location,
       supplier_sku, supplier_name,
       default_location_company as location_company, availability
from public.catalogue_variants;

create or replace function public.create_catalogue_product(p_product jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.user_role;
  product_uuid uuid := gen_random_uuid();
  variant_uuid uuid := gen_random_uuid();
  category_uuid uuid;
  supplier_uuid uuid;
  location_uuid uuid;
  own_sku text;
  barcode_value text;
  supplier_sku_value text;
  availability_value public.variant_availability;
begin
  actor_id := coalesce(nullif(p_product->>'actorId', '')::uuid, auth.uid());
  select role into actor_role from public.profiles where id = actor_id and active = true;
  if actor_role not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can add products';
  end if;

  category_uuid := nullif(p_product->>'categoryId', '')::uuid;
  supplier_uuid := nullif(p_product->>'supplierId', '')::uuid;
  location_uuid := nullif(p_product->>'locationId', '')::uuid;
  own_sku := upper(trim(p_product->>'sku'));
  barcode_value := upper(trim(p_product->>'barcode'));
  supplier_sku_value := nullif(trim(p_product->>'supplierSku'), '');
  availability_value := coalesce(nullif(p_product->>'availability', '')::public.variant_availability, 'stocked');

  if category_uuid is null or not exists(select 1 from public.categories where id = category_uuid and active) then
    raise exception 'Select a valid category';
  end if;
  if supplier_uuid is null or not exists(select 1 from public.suppliers where id = supplier_uuid and active) then
    raise exception 'Select a valid supplier';
  end if;
  if location_uuid is null or not exists(select 1 from public.locations where id = location_uuid and active) then
    raise exception 'Select a valid location';
  end if;
  if own_sku is null or own_sku = '' then raise exception 'Own SKU is required'; end if;
  if barcode_value is null or barcode_value = '' then raise exception 'Barcode is required'; end if;
  if barcode_value !~ '^[ -~]{4,48}$' then raise exception 'Barcode must contain 4 to 48 printable characters'; end if;

  insert into public.products(
    id, sheet_product_id, category_id, brand, model, name, description,
    main_photo_path, box_label_photo_path, active, created_by
  ) values (
    product_uuid, 'PROD-' || upper(substr(product_uuid::text, 1, 8)), category_uuid,
    coalesce(nullif(trim(p_product->>'brand'), ''), 'Unbranded'),
    coalesce(nullif(trim(p_product->>'model'), ''), own_sku),
    trim(p_product->>'name'), nullif(trim(p_product->>'description'), ''),
    nullif(p_product->>'mainPhotoPath', ''), nullif(p_product->>'boxLabelPhotoPath', ''),
    true, actor_id
  );

  insert into public.product_variants(
    id, sheet_variant_id, product_id, sku, supplier_sku, supplier_id, barcode,
    attributes, selling_unit, srp, reorder_level, default_location_id, availability,
    pieces_per_box, sqm_per_box, photo_path, active, created_by
  ) values (
    variant_uuid, 'VAR-' || upper(substr(variant_uuid::text, 1, 8)), product_uuid,
    own_sku, supplier_sku_value, supplier_uuid, barcode_value,
    coalesce(p_product->'attributes', '{}'::jsonb),
    coalesce(nullif(p_product->>'sellingUnit', '')::public.selling_unit, 'piece'),
    greatest(coalesce(nullif(p_product->>'srp', '')::numeric, 0), 0),
    greatest(coalesce(nullif(p_product->>'reorderLevel', '')::numeric, 0), 0),
    location_uuid, availability_value,
    nullif(p_product->>'piecesPerBox', '')::numeric,
    nullif(p_product->>'sqmPerBox', '')::numeric,
    nullif(p_product->>'mainPhotoPath', ''), true, actor_id
  );

  return jsonb_build_object(
    'id', variant_uuid,
    'productId', product_uuid,
    'sku', own_sku,
    'barcode', barcode_value,
    'productSlug', lower(regexp_replace(own_sku, '[^a-zA-Z0-9]+', '-', 'g'))
  );
exception
  when unique_violation then
    raise exception 'Own SKU, supplier SKU, or barcode already belongs to another product';
end;
$$;

commit;
