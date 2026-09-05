begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'manager', 'sales_employee', 'stock_employee', 'cashier');
create type public.inventory_transaction_type as enum (
  'receiving', 'transfer', 'sale', 'customer_return', 'supplier_return',
  'damaged', 'display_stock', 'physical_count_adjustment', 'reversal'
);
create type public.inventory_transaction_status as enum ('draft', 'posted', 'reversed', 'cancelled');
create type public.transfer_status as enum ('draft', 'prepared', 'in_transit', 'received', 'cancelled');
create type public.sale_status as enum ('draft', 'held', 'quotation', 'completed', 'cancelled');
create type public.selling_unit as enum ('piece', 'box', 'set', 'pair', 'square_metre', 'linear_metre');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  role public.user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  attribute_schema jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint category_schema_is_object check (jsonb_typeof(attribute_schema) = 'object')
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  contact_name text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  brand text not null,
  model text not null,
  name text not null,
  description text,
  main_photo_path text,
  box_label_photo_path text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null unique,
  barcode text not null unique,
  attributes jsonb not null default '{}'::jsonb,
  selling_unit public.selling_unit not null default 'piece',
  srp numeric(14,2) not null check (srp >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  default_location_id uuid references public.locations(id) on delete restrict,
  pieces_per_box numeric(14,3) check (pieces_per_box is null or pieces_per_box > 0),
  sqm_per_box numeric(14,4) check (sqm_per_box is null or sqm_per_box > 0),
  photo_path text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variant_attributes_is_object check (jsonb_typeof(attributes) = 'object'),
  constraint box_conversions_match_unit check (
    selling_unit = 'box' or (pieces_per_box is null and sqm_per_box is null)
  )
);

-- Private pricing is physically separated from employee-readable catalogue data.
create table public.variant_private_costs (
  variant_id uuid primary key references public.product_variants(id) on delete restrict,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  landed_cost numeric(14,4) not null check (landed_cost >= 0),
  minimum_selling_price numeric(14,2) not null check (minimum_selling_price >= 0),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  effective_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint minimum_price_not_below_landed_cost check (minimum_selling_price >= landed_cost)
);

create table public.variant_cost_history (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  landed_cost numeric(14,4) not null check (landed_cost >= 0),
  effective_at timestamptz not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number bigint generated always as identity unique,
  transaction_type public.inventory_transaction_type not null,
  status public.inventory_transaction_status not null default 'draft',
  transfer_status public.transfer_status,
  source_location_id uuid references public.locations(id) on delete restrict,
  destination_location_id uuid references public.locations(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  delivery_reference text,
  reference_number text,
  reason text,
  notes text,
  attachment_path text,
  reverses_transaction_id uuid unique references public.inventory_transactions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  posted_by uuid references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  constraint transfer_locations_are_distinct check (
    source_location_id is null or destination_location_id is null or source_location_id <> destination_location_id
  ),
  constraint reversal_has_original check (
    (transaction_type = 'reversal' and reverses_transaction_id is not null)
    or (transaction_type <> 'reversal' and reverses_transaction_id is null)
  ),
  constraint posted_has_actor_and_time check (
    status not in ('posted', 'reversed') or (posted_by is not null and posted_at is not null)
  )
);

create table public.inventory_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  damaged_quantity numeric(14,3) not null default 0 check (damaged_quantity >= 0),
  created_at timestamptz not null default now()
);

create index inventory_lines_variant_location_idx on public.inventory_transaction_lines(variant_id, location_id);
create index inventory_transactions_posted_idx on public.inventory_transactions(status, posted_at);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number bigint generated always as identity unique,
  status public.sale_status not null default 'draft',
  customer_name text,
  fulfilment_method text check (fulfilment_method in ('release_now', 'customer_pickup', 'delivery')),
  payment_method text check (payment_method in ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'split')),
  notes text,
  inventory_transaction_id uuid unique references public.inventory_transactions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz
);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  selling_unit public.selling_unit not null,
  original_srp numeric(14,2) not null check (original_srp >= 0),
  actual_selling_price numeric(14,2) not null check (actual_selling_price >= 0),
  discount_amount numeric(14,2) generated always as (greatest(0, original_srp - actual_selling_price)) stored,
  discount_percentage numeric(7,4) generated always as (
    case when original_srp = 0 then 0 else greatest(0, (original_srp - actual_selling_price) / original_srp * 100) end
  ) stored,
  discount_reason text,
  approval_required boolean not null default false,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete restrict,
  event_type text not null,
  entity_table text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_ip inet
);

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.has_role(allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = any(allowed_roles), false);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
create trigger private_costs_set_updated_at before update on public.variant_private_costs for each row execute function public.set_updated_at();

create or replace function public.prevent_posted_transaction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_status public.inventory_transaction_status;
begin
  if current_setting('app.allow_posted_mutation', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'inventory_transactions' then
    existing_status := old.status;
  else
    select status into existing_status from public.inventory_transactions where id = old.transaction_id;
  end if;

  if existing_status in ('posted', 'reversed') then
    raise exception 'Posted inventory transactions are immutable. Create a reversal transaction.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger immutable_inventory_transactions before update or delete on public.inventory_transactions for each row execute function public.prevent_posted_transaction_mutation();
create trigger immutable_inventory_lines before update or delete on public.inventory_transaction_lines for each row execute function public.prevent_posted_transaction_mutation();

create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log(user_id, event_type, entity_table, entity_id, metadata)
  values (
    auth.uid(), lower(tg_op) || '_' || tg_table_name, tg_table_name,
    coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
    jsonb_build_object('operation', tg_op)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit_products after insert or update on public.products for each row execute function public.write_audit_event();
create trigger audit_variants after insert or update on public.product_variants for each row execute function public.write_audit_event();
create trigger audit_private_costs after insert or update on public.variant_private_costs for each row execute function public.write_audit_event();
create trigger audit_inventory_transactions after insert or update on public.inventory_transactions for each row execute function public.write_audit_event();
create trigger audit_sales after insert or update on public.sales for each row execute function public.write_audit_event();
create trigger audit_sale_lines after insert or update on public.sale_lines for each row execute function public.write_audit_event();

create or replace view public.inventory_balances
with (security_invoker = true)
as
select
  line.variant_id,
  line.location_id,
  sum(line.quantity_delta)::numeric(14,3) as available_quantity
from public.inventory_transaction_lines line
join public.inventory_transactions transaction on transaction.id = line.transaction_id
where transaction.status = 'posted'
group by line.variant_id, line.location_id;

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
  variant.active
from public.product_variants variant
join public.products product on product.id = variant.product_id
join public.categories category on category.id = product.category_id
left join public.inventory_balances balance on balance.variant_id = variant.id
left join public.locations location on location.id = variant.default_location_id
where product.active = true
group by variant.id, product.id, category.id, location.id;

create or replace view public.inventory_export
with (security_invoker = true)
as
select sku, barcode, product_name, category, brand, model, attributes, selling_unit,
       srp as selling_price, available_quantity, default_location as location
from public.catalogue_variants;

create or replace view public.owner_margin_report
with (security_invoker = true)
as
select catalogue.id, catalogue.sku, catalogue.product_name, catalogue.srp,
       costs.unit_cost, costs.landed_cost, costs.minimum_selling_price,
       catalogue.srp - costs.landed_cost as gross_margin_amount
from public.catalogue_variants catalogue
join public.variant_private_costs costs on costs.variant_id = catalogue.id;

create or replace function public.validate_category_attributes(
  p_category_id uuid,
  p_attributes jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  required_key text;
  schema jsonb;
begin
  if jsonb_typeof(p_attributes) <> 'object' then return false; end if;
  select attribute_schema into schema from public.categories where id = p_category_id;
  for required_key in select jsonb_array_elements_text(coalesce(schema->'required', '[]'::jsonb))
  loop
    if not p_attributes ? required_key then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.post_inventory_transaction(p_transaction jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
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
  actor_role := public.current_user_role();
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
    p_transaction->>'reason', p_transaction->>'notes', auth.uid()
  ) returning id into transaction_id;

  for line in select value from jsonb_array_elements(p_transaction->'lines')
  loop
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
  update public.inventory_transactions set status = 'posted', posted_by = auth.uid(), posted_at = now()
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
end;
$$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.variant_private_costs enable row level security;
alter table public.variant_cost_history enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.inventory_transaction_lines enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read_self_or_owner on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(array['owner']::public.user_role[]));
create policy profiles_owner_manage on public.profiles for all to authenticated using (public.has_role(array['owner']::public.user_role[])) with check (public.has_role(array['owner']::public.user_role[]));
create policy authenticated_read_categories on public.categories for select to authenticated using (true);
create policy authenticated_read_locations on public.locations for select to authenticated using (true);
create policy authenticated_read_products on public.products for select to authenticated using (true);
create policy authenticated_read_variants on public.product_variants for select to authenticated using (true);
create policy managers_manage_catalogue on public.categories for all to authenticated using (public.has_role(array['owner','manager']::public.user_role[])) with check (public.has_role(array['owner','manager']::public.user_role[]));
create policy managers_manage_locations on public.locations for all to authenticated using (public.has_role(array['owner','manager']::public.user_role[])) with check (public.has_role(array['owner','manager']::public.user_role[]));
create policy managers_manage_products on public.products for all to authenticated using (public.has_role(array['owner','manager']::public.user_role[])) with check (public.has_role(array['owner','manager']::public.user_role[]));
create policy managers_manage_variants on public.product_variants for all to authenticated using (public.has_role(array['owner','manager']::public.user_role[])) with check (public.has_role(array['owner','manager']::public.user_role[]));
create policy stock_team_read_suppliers on public.suppliers for select to authenticated using (public.has_role(array['owner','manager','stock_employee']::public.user_role[]));
create policy managers_manage_suppliers on public.suppliers for all to authenticated using (public.has_role(array['owner','manager']::public.user_role[])) with check (public.has_role(array['owner','manager']::public.user_role[]));
create policy owner_only_private_costs on public.variant_private_costs for all to authenticated using (public.has_role(array['owner']::public.user_role[])) with check (public.has_role(array['owner']::public.user_role[]));
create policy owner_only_cost_history on public.variant_cost_history for all to authenticated using (public.has_role(array['owner']::public.user_role[])) with check (public.has_role(array['owner']::public.user_role[]));
create policy authenticated_read_transactions on public.inventory_transactions for select to authenticated using (true);
create policy authenticated_read_transaction_lines on public.inventory_transaction_lines for select to authenticated using (true);
create policy sales_team_read_sales on public.sales for select to authenticated using (created_by = auth.uid() or public.has_role(array['owner','manager']::public.user_role[]));
create policy sales_team_create_sales on public.sales for insert to authenticated with check (created_by = auth.uid() and public.has_role(array['owner','manager','sales_employee','cashier']::public.user_role[]));
create policy sales_team_read_lines on public.sale_lines for select to authenticated using (exists(select 1 from public.sales where sales.id = sale_lines.sale_id and (sales.created_by = auth.uid() or public.has_role(array['owner','manager']::public.user_role[]))));
create policy owner_read_audit_log on public.audit_log for select to authenticated using (public.has_role(array['owner']::public.user_role[]));

grant usage on schema public to authenticated;
grant select on public.catalogue_variants, public.inventory_balances, public.inventory_export to authenticated;
grant select on public.owner_margin_report to authenticated;
grant execute on function public.post_inventory_transaction(jsonb) to authenticated;
revoke all on public.variant_private_costs from anon;
revoke all on public.variant_cost_history from anon;
revoke all on public.owner_margin_report from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy product_photos_authenticated_read on storage.objects for select to authenticated using (bucket_id = 'product-photos');
create policy product_photos_manager_insert on storage.objects for insert to authenticated with check (bucket_id = 'product-photos' and public.has_role(array['owner','manager']::public.user_role[]));
create policy product_photos_manager_update on storage.objects for update to authenticated using (bucket_id = 'product-photos' and public.has_role(array['owner','manager']::public.user_role[])) with check (bucket_id = 'product-photos' and public.has_role(array['owner','manager']::public.user_role[]));

commit;
