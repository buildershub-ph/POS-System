# Setting up Builder's Hub Inventory on a fresh Supabase project

This project is a Next.js app backed by Supabase (Postgres + Auth + Storage).
Follow this once to get a live deployment fully working with real logins, the
real catalogue, and role-based access.

## 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com) and note down:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never expose this to the browser)

## 2. Run the database migrations, in order

In the Supabase SQL Editor, run every file in `supabase/migrations/` **in filename
order** (0001 → 0009). Each file is idempotent (safe to re-run), but they must
run in sequence the first time because later files depend on tables and
columns the earlier ones create.

What each migration does, briefly:

| File | What it sets up |
|---|---|
| `0001` | Core schema: products, variants, locations, suppliers, inventory ledger, sales, roles, RLS policies. `variant_private_costs` is only ever readable by the `owner` role — this is how cost/profit stays hidden from everyone else. |
| `0002`–`0007` | Auth wiring, Google-Sheets sync support, receiving workflow, supplier/photo fields. |
| `0008` | Adds **display-only / order-by-request** items (`availability` column) and **multi-branch locations** — Canlalay Branch and Kosch Warehouse are added as Sister Company sites alongside the main store's Showroom/Warehouse/Display. |
| `0009` | **Wipes the old demo/sample catalogue** and loads the real 54-item Builder's Hub catalogue (tiles, ceiling panels, fluted panels, doors, door jambs) with the actual costs, SRPs, and on-hand quantities from the inventory sheet, all at the Main Showroom. |

## 3. Create the owner's login

Migration `0002` seeds an `owner` profile row for `abillarjhona@gmail.com`, but
it isn't linked to a real login yet — Supabase Auth users are created
separately from the `profiles` table. Do this once:

1. In Supabase → **Authentication → Users → Add user**, create a user with
   that email and a password of your choice. Copy the generated **User UID**.
2. In the SQL Editor, point the seeded owner profile at that real user:

   ```sql
   delete from public.profiles where id = '00000000-0000-0000-0000-000000000001';
   insert into public.profiles (id, email, full_name, role, active)
   values ('<paste the User UID here>', 'abillarjhona@gmail.com', 'Jhona Abillar', 'owner', true);
   ```

3. Sign in at `/login` with that email and password. You now have full owner
   access, including cost & margin data and the **Team** page.

From then on, **do not use the Supabase dashboard to add more staff** — sign
in as the owner and use the **Team** page in the app itself. It creates both
the login and the role-scoped profile in one step, and shows you the
temporary password to hand to that employee.

## 4. Set environment variables on your host (e.g. Netlify)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SITE_URL=https://your-site.netlify.app
```

See `NETLIFY-DEPLOY.md` for the rest of the Netlify-specific steps.

## 5. Add product photographs

The real catalogue is loaded without photos. Open any product in
**Inventory**, then use **Receive Stock** (or re-open the item and upload a
photo) — the item photo upload is already wired to Supabase Storage. Do this
at your own pace; nothing else depends on photos being present.

## What's already enforced without any extra setup

- **Unique logins & limited access** — every sign-in is a real Supabase Auth
  account tied to a `profiles` row with one role (`owner`, `manager`,
  `sales_employee`, `stock_employee`, `cashier`). Only `owner` can see cost,
  landed cost, and margin — this is enforced both by the database (Row Level
  Security) and by the UI.
- **Barcodes** — every new product gets a Code 128 barcode generated
  automatically when it's added (see the "Add Product" wizard), printable as
  a label.
- **Scan to check stock** — the barcode/SKU field in Cashier Mode and the
  dedicated Scan page both look up live availability.
- **Display-only items** — when adding a product, set its availability to
  "Display only" if it's a showroom sample kept for reference and ordered in
  rather than stocked. It's excluded from Cashier Mode's sellable grid and
  shown with a distinct badge everywhere else.
- **Multi-branch stock** — the Main Store (Showroom/Warehouse/Display),
  Canlalay Branch, and Kosch Warehouse are all selectable locations for
  receiving stock or adding new products, and each carries which company
  (Builder's Hub vs. the sister company) it belongs to.
