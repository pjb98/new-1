# Tiny Dead — Token Reward Backend (reference skeleton)

The trusted authority that the static game client **cannot** be. It owns the
earnings ledger and is the **only** thing that signs `$TOKEN` payouts. Stand this
up and point the game at it (menu → **⚙ next to Claim**) to turn real-token
earning on.

> ⚠️ This is a **starting skeleton**, not production. It proves the architecture
> (signature-verified, server-authoritative, replay-safe claims) and does a real
> on-chain SPL transfer when configured — but several things below MUST be
> hardened before mainnet/real money. Legal/compliance is out of scope here.

## Why the client can't do this
The game ships as a static site: `localStorage`, score, gold and loot are all on
the player's machine and trivially forgeable. If the client could say "I earned
500 tokens," everyone would drain the treasury immediately. So the client only:
1. reads `GET /claimable?address=…` (display), and
2. forwards a **wallet-signed** claim request to `POST /claim`.

The amount is decided **here**, from this server's ledger — never by the client.

## Trust boundary
| Layer | Responsibility |
| --- | --- |
| **Game client** (`src/token.ts`, `src/wallet.ts`) | connect wallet, read claimable, sign + forward claim. No authority over value. |
| **This backend** | earnings ledger, signature/replay checks, withdrawal caps, signs treasury transfer. |
| **Solana** | `$TOKEN` mint, treasury wallet, settlement. |

## The economy (see /ECONOMY.md)
Pump.fun trading fees (+ box/cosmetic sales) fund the **treasury**. The treasury
buys items from players (buyback, a liquidity floor) and relists them; players
also sell to each other on the **marketplace** with a **5% fee** back to the
treasury. Players withdraw their in-game `$TOKEN` balance to their wallet.

## Endpoints
- `GET  /health` — liveness.
- `GET  /treasury` — treasury balance + active listing count.
- `POST /treasury/deposit` *(admin)* — record fees arriving (Pump.fun creator fees, box sales).
- `GET  /balance?address=…` · `GET /claimable?address=…` — a player's `$TOKEN` (same number; the client reads `claimable`).
- `POST /credit` *(admin)* — grant rewards to a player's balance (prize pools / events). **Never from the game client.**
- `GET  /market` — active listings.
- `POST /market/list` — a player lists an item for `$TOKEN`.
- `POST /market/buy` — a player buys a listing; 5% fee → treasury, rest → seller.
- `POST /buyback` *(admin)* — treasury buys an item from a player and relists it at a markup.
- `POST /box/open` *(admin)* — provably-fair (commit-reveal) box outcome decided server-side.
- `POST /earn/login` — player signs ONCE per session → short-lived earn token (so reporting after each run doesn't pop a wallet prompt every time).
- `POST /earn` — `{ token, gold }` → converts gameplay gold into claimable `$TINY`, **hard-capped** (see below). The static client is forgeable, so these caps — not trust — bound the payout. Returns `{ credited, balance, dailyRemaining }`.
- `POST /claim` — verifies wallet signature + freshness + replay, pays out the balance, returns `{ ok, claimed, txid }`.

### Earn caps (env — tune for your treasury, funded by coin trading fees)
- `EARN_RATE` (def `0.01`) — `$TINY` credited per 1 gold earned.
- `EARN_PER_REQUEST_MAX` (def `50`) — max credited per single report.
- `EARN_DAILY_MAX` (def `200`) — max credited per wallet per UTC day. **This is the main throttle on payout/abuse.**
- `EARN_MIN_INTERVAL_MS` (def `15000`) — min gap between a wallet's reports.
- `EARN_TOKEN_TTL_MS` (def `6h`) — earn-session token lifetime.

> Earn is **client-reported** (the game is static/forgeable), so credits are bounded by the daily cap, not verified gameplay. Keep `EARN_DAILY_MAX` conservative relative to treasury inflow; claims pay from the treasury, so fund it from fees before turning earning loose.

## Run it (dry-run, no real tokens)
```bash
cd token-backend
cp .env.example .env          # leave TREASURY_SECRET / TOKEN_MINT blank for dry-run
npm install
npm run dev                   # http://localhost:8787
```
Then in the game: **⚙ (next to Claim) → `http://localhost:8787`**. Connect a
wallet, and use an admin call to seed a balance:
```bash
curl -X POST localhost:8787/credit -H 'content-type: application/json' \
  -H 'x-admin-secret: <ADMIN_SECRET>' \
  -d '{"address":"<YOUR_WALLET>","amount":25}'
```
Claiming will sign your wallet message, verify it, and return a `DRYRUN-…` txid.
Set `TOKEN_MINT` + `TREASURY_SECRET` (devnet first) to do real transfers.

## Before production — DO NOT SKIP
- [ ] Replace the JSON-file ledger with a real DB (Postgres/SQLite) + transactions.
- [ ] Feed `/credit` from **server-authoritative** game logic only (don't trust client score — gate earning on box opens + marketplace, per the design notes).
- [ ] Anti-Sybil / bot / multi-account + wash-trade detection; per-account + global withdrawal limits; cooldown/vesting on earned credits.
- [ ] Treasury **hot/cold split** (small hot float, multisig cold reserve) + a global daily-outflow circuit breaker.
- [ ] Harden box RNG: published per-epoch seed commits, and on-chain VRF (e.g. Switchboard) for high-value tiers.
- [ ] Use the mint's real **decimals** in `payout()` (skeleton assumes 0).
- [ ] Restrict CORS to your game origin; rate-limit; add auth/session (Sign-In-With-Solana).
- [ ] Fund rewards from **real revenue** (box/cosmetic sales → buyback), not emission — otherwise the token death-spirals.
