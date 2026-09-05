begin;

create or replace view public.portal_catalogue
with (security_invoker = true)
as
select
  catalogue.*,
  coalesce(incoming.incoming_quantity, 0)::numeric(14,3) as incoming_quantity,
  incoming.source_invoice,
  incoming.delivery_reference,
  incoming.delivery_date,
  incoming.draft_transaction_id
from public.catalogue_variants catalogue
left join lateral (
  select
    sum(line.quantity_delta) as incoming_quantity,
    max(transaction.reference_number) as source_invoice,
    max(transaction.delivery_reference) as delivery_reference,
    max(transaction.created_at::date) as delivery_date,
    max(transaction.id::text)::uuid as draft_transaction_id
  from public.inventory_transaction_lines line
  join public.inventory_transactions transaction on transaction.id = line.transaction_id
  where line.variant_id = catalogue.id
    and transaction.transaction_type = 'receiving'
    and transaction.status = 'draft'
) incoming on true;

grant select on public.portal_catalogue to authenticated;

create or replace function public.post_sites_inventory_transaction(p_transaction jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  posted_id uuid;
  draft_id uuid;
  line jsonb;
begin
  posted_id := public.post_inventory_transaction(p_transaction);

  perform set_config('app.allow_posted_mutation','on',true);
  update public.inventory_transactions
  set supplier_id = nullif(p_transaction->>'supplierId','')::uuid,
      delivery_reference = nullif(p_transaction->>'deliveryReference',''),
      reference_number = nullif(p_transaction->>'sourceInvoice','')
  where id = posted_id;
  perform set_config('app.allow_posted_mutation','off',true);

  draft_id := nullif(p_transaction->>'supersedesDraftId','')::uuid;
  if draft_id is not null then
    for line in select value from jsonb_array_elements(p_transaction->'lines') loop
      delete from public.inventory_transaction_lines
      where transaction_id = draft_id and variant_id = (line->>'variantId')::uuid;
    end loop;

    if not exists (select 1 from public.inventory_transaction_lines where transaction_id = draft_id) then
      update public.inventory_transactions set status = 'cancelled' where id = draft_id and status = 'draft';
    end if;
  end if;

  return posted_id;
exception when others then
  perform set_config('app.allow_posted_mutation','off',true);
  raise;
end;
$$;

revoke all on function public.post_sites_inventory_transaction(jsonb) from public, anon, authenticated;
grant execute on function public.post_sites_inventory_transaction(jsonb) to service_role;

commit;
