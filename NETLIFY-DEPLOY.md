# Netlify deployment

This inventory portal uses server-side routes, login, photo uploads, and Supabase. It must be deployed as a Next.js application, not through Netlify's static drag-and-drop uploader.

## Recommended deployment

1. Put the project in a private Git repository.
2. In Netlify, select **Add new project** and **Import an existing project**.
3. Select the repository. Netlify will read `netlify.toml` automatically.
4. Add these environment variables under **Project configuration → Environment variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy the project.

Do not place the service-role key in this file, `netlify.toml`, or a public repository.

## Build settings

- Build command: `npm run build:netlify`
- Publish directory: `.next`
- Node.js version: `22.13.0`

The existing Supabase database remains the source of truth, so inventory, users, photographs, and transactions are shared between deployments.
