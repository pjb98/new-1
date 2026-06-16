# Tiny Dead cloud-save (Supabase backend)

Durable, wallet-signature-gated cloud save for Tiny Dead, running on Supabase
(Postgres + a single Edge Function). Replaces the old PartyKit save party.

## What's here

- `migrations/<ts>_cloud_save.sql` — `saves` + `save_tokens` tables, RLS locked.
- `functions/save/index.ts` — the Deno Edge Function (login + push actions).
- `config.toml` — sets `verify_jwt = false` for the `save` function.

## Security model

- Both tables have **Row Level Security enabled with NO policies**, so anon/auth
  API clients (anyone with the public anon key) are fully denied — they can't
  read or write `saves` or `save_tokens` at all.
- Only the **service role** can touch the tables, and it's used exclusively by
  the `save` Edge Function (service-role calls bypass RLS).
- The function authenticates callers itself: `/login` verifies an **ed25519
  wallet signature** over a timestamped message (±5 min skew) before minting a
  6-hour session token; `/push` requires that token (must exist, be unexpired,
  and match the address). The client therefore **cannot forge** a save for an
  address it doesn't control.
- `verify_jwt` is disabled so the static game client can call the function
  directly (no Supabase JWT/anon key), relying on the wallet-sig auth above.

## One-time setup / deploy

```sh
# 1. Create a Supabase project at https://supabase.com (note its project ref).

# 2. Link this repo to that project (run from repo root; reads supabase/).
supabase link --project-ref <project-ref>

# 3. Apply the schema migration (creates tables + RLS).
supabase db push

# 4. Deploy the Edge Function. It MUST be deployed without JWT verification.
#    config.toml already sets verify_jwt = false; pass --no-verify-jwt too to
#    be explicit / if not picking up the config.
supabase functions deploy save --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into Edge
Functions by the platform — you do NOT need to set them as secrets manually.

## Point the game at it

Set the build-time env var when building the web client:

```sh
VITE_SAVE_URL=https://<project-ref>.supabase.co/functions/v1/save
```

(The client also accepts this URL at runtime via `setSaveApiUrl(...)`, which
persists it to `localStorage`.) When `VITE_SAVE_URL` is unset, cloud save is
simply disabled and the game runs localStorage-only.

## Wire contract

Single endpoint, two JSON POST actions:

- **login** — `{ action:"login", address, message, signature /*base64*/ }`
  → `200 { ok:true, token, save:object|null, updated:number /*epoch ms, 0 if none*/ }`
  or `401 { ok:false, error }`.
  `message` must be exactly `Tiny Dead save sync\naddress: <address>\nts: <ms>`.

- **push** — `{ action:"push", address, token, save:object, updated:number }`
  → `200 { ok:true, updated:number /*epoch ms*/ }` or
  `400` (bad save) / `413` (>256 KB) / `401` (bad/expired token).

CORS is open (`Access-Control-Allow-Origin: *`) with `OPTIONS` preflight handled.
