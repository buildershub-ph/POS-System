begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.assert_sheet_sync_secret(p_sync_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_sync_secret is null or extensions.digest(p_sync_secret, 'sha256') <> decode('7ad7d35a0ea92d271ee0702a32c8b502fd868e1e15facde2791830430ebbe65f', 'hex') then
    raise exception 'Invalid sheet synchronization credential';
  end if;
end;
$$;

create or replace function public.sheet_sync_snapshot(p_sync_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_sheet_sync_secret(p_sync_secret);

  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.code), '[]'::jsonb) from public.categories row_data),
    'products', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sheet_product_id), '[]'::jsonb) from public.products row_data),
    'variants', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sku), '[]'::jsonb) from public.product_variants row_data),
    'locations', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.code), '[]'::jsonb) from public.locations row_data),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.email), '[]'::jsonb) from public.profiles row_data),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc), '[]'::jsonb) from public.inventory_transactions row_data),
    'transactionLines', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc), '[]'::jsonb) from public.inventory_transaction_lines row_data),
    'balances', (select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb) from public.inventory_balances row_data),
    'privateCosts', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.effective_at desc), '[]'::jsonb) from public.variant_private_costs row_data),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.invoice_number desc), '[]'::jsonb) from public.purchase_invoices row_data),
    'charges', (select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sheet_charge_id), '[]'::jsonb) from public.purchase_charges row_data)
  );
end;
$$;

create or replace function public.apply_sheet_edit_secure(
  p_sheet text,
  p_row jsonb,
  p_actor_email text,
  p_sync_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.assert_sheet_sync_secret(p_sync_secret);
  return public.apply_sheet_edit(p_sheet, p_row, p_actor_email);
end;
$$;

revoke all on function public.assert_sheet_sync_secret(text) from public, anon, authenticated;
revoke all on function public.sheet_sync_snapshot(text) from public, anon, authenticated;
revoke all on function public.apply_sheet_edit_secure(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.sheet_sync_snapshot(text) to anon, authenticated;
grant execute on function public.apply_sheet_edit_secure(text, jsonb, text, text) to anon, authenticated;

commit;
