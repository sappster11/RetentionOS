# Auth (Phase 0.3)

Auth is **env-gated**: it lights up only when both `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are set (see `apps/web/lib/auth.ts`, `authEnabled`).

## Local dev (no Supabase — the default)

With no Supabase env vars set, the app runs exactly as it did before Phase 0.3:

- `middleware.ts` is a no-op (`NextResponse.next()`), no redirects.
- `getCurrentOrg()` (`apps/web/lib/org.ts`) falls back to `getDefaultOrganization()` —
  the `DEV_ORG_ID` / first-organization stand-in.
- `/login` renders a "not configured, running in local dev mode" notice with a link
  straight to `/clients`.
- `/auth/callback` just redirects to `/clients`.

Nothing in this phase requires a Supabase project to build, typecheck, or run locally
against Postgres.

## Enabling auth

1. Create a Supabase project and apply the migrations in `packages/db/migrations` to it
   (these already define `auth.users`-backed `public.users`, `public.memberships`, and
   RLS policies — see `0001_foundations.sql`).
2. Set these env vars for `apps/web` (e.g. in `.env.local` or your hosting provider):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Restart the app. Once both vars are present:
   - `middleware.ts` refreshes the Supabase session cookie on every request and
     redirects unauthenticated visitors to `/login` for any route other than
     `/login`, `/auth/*`, and static assets.
   - `/login` renders an email magic-link form (`supabase.auth.signInWithOtp`).
   - `/auth/callback` exchanges the auth code for a session
     (`exchangeCodeForSession`), upserts a `public.users` profile row, and redirects
     to `/clients`.
   - `getCurrentOrg()` resolves the org from the signed-in user's `public.memberships`
     row instead of the dev stand-in (falls back to the dev stand-in only if the user
     has no membership yet).
   - The clients page shows the signed-in email with a "Sign out" button
     (`apps/web/app/auth/actions.ts`, `signOutAction`).

## Magic-link flow

1. User enters their email on `/login`.
2. Supabase emails a link to `/auth/callback?code=...`.
3. The callback route exchanges the code for a session, upserts `public.users`, and
   redirects to `/clients`.
4. For a signed-in user to see any org data, they need a row in `public.memberships`
   linking them to an `organizations.id` — that provisioning step is out of scope for
   Phase 0.3 and is expected to be seeded/administered separately (e.g. via the
   service role, which bypasses RLS).
