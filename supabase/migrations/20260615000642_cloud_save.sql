-- Tiny Dead wallet cloud-save schema.
--
-- Security posture: Row Level Security is ENABLED on both tables and NO policies
-- are defined. That means anon/auth API clients (anyone holding the public anon
-- key) are fully locked out — every read/write is denied by default. ONLY the
-- service role (used exclusively by the `save` Edge Function, which bypasses RLS)
-- can touch these tables. The Edge Function does its own ed25519 wallet-signature
-- auth before writing, so the client can never forge a save.

-- One durable save blob per wallet address (base58 Solana pubkey).
create table if not exists public.saves (
  address text primary key,
  blob    jsonb not null,
  updated timestamptz not null default now()
);

-- Short-lived session tokens minted by /login and presented on /push.
create table if not exists public.save_tokens (
  token   text primary key,
  address text not null,
  expires timestamptz not null
);

-- Speeds up the opportunistic "delete expired tokens" sweep done on each login.
create index if not exists save_tokens_expires_idx on public.save_tokens (expires);

-- Lock both tables down: RLS on, zero policies => only the service role gets in.
alter table public.saves       enable row level security;
alter table public.save_tokens enable row level security;
