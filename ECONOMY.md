# Tiny Dead — Token Economy

The canonical flow for the native `$TOKEN`. Kept deliberately simple: the
treasury is funded by trading fees, it pays players for items, and items change
hands on the marketplace.

## The flywheel

```
        💵 Pump.fun trading fees  (+ box / cosmetic sales)
                       │
                       ▼
                 ┌───────────┐  ◀── 5% fee on every marketplace sale
                 │ TREASURY  │
                 └───────────┘
                   │      ▲
        buyback    │      │  fee on resale
     (pay $TOKEN)  ▼      │
                 PLAYER ──┴── item ──▶ MARKETPLACE ◀── buy w/ $TOKEN ── OTHER PLAYERS
```

1. **Fees in.** Pump.fun creator/trading fees (and any box/cosmetic sales) land
   in the **treasury wallet**.
2. **Buyback.** The treasury buys in-game items from players for `$TOKEN`, so
   players always have a guaranteed "sell" button (liquidity floor). Those items
   get relisted on the marketplace.
3. **Marketplace.** Players list items for `$TOKEN`; other players buy them. A
   **5% fee** on each sale flows back to the treasury.
4. **Claim.** A player's in-game `$TOKEN` balance can be withdrawn to their
   wallet (the backend verifies the wallet signature and sends the transfer).

## Two currencies

| | **Gold** (soft) | **$TOKEN** (hard) |
| --- | --- | --- |
| Where | in-game only (client) | backend ledger + on-chain |
| Source | gameplay: kills, idle, quests | marketplace sales, treasury buyback, rewards |
| Spend | mystery boxes, evolutions, cosmetics | premium boxes, marketplace, withdraw |
| Cashable | no | yes (claim → wallet) |

**No gold → $TOKEN bridge.** Gameplay never mints the hard token; `$TOKEN` only
enters a player's hands from a marketplace sale or a treasury payout.

## Treasury

- **Inflows:** Pump.fun trading fees, marketplace fees (5%), box/cosmetic sales.
- **Outflows:** buybacks (paying players for items), prize pools / rewards.
- It's a single accounted balance. Inflows feed it, payouts draw from it; if it's
  empty, buybacks/prizes pause until fees refill it.

## Faucet / sink summary

| Faucet ($TOKEN to players) | Sink ($TOKEN out of circulation / to treasury) |
| --- | --- |
| Sell an item on the marketplace | 5% marketplace fee → treasury |
| Treasury buyback of an item | Buy a premium mystery box with $TOKEN |
| Prize pools / events | Marketplace purchases (paid to seller, fee to treasury) |
|  | Withdraw → leaves the in-game ledger |

## Backend endpoints (token-backend/)

- `GET  /treasury` — treasury balance + live listing count.
- `POST /treasury/deposit` *(admin)* — record fees arriving (Pump.fun / sales).
- `GET  /balance?address=` / `GET /claimable?address=` — a player's $TOKEN.
- `POST /credit` *(admin)* — grant rewards to a player's balance.
- `POST /buyback` *(admin)* — treasury buys an item from a player and relists it.
- `GET  /market` — active listings.
- `POST /market/list` — a player lists an item for $TOKEN.
- `POST /market/buy` — a player buys a listing; 5% fee → treasury.
- `POST /box/open` *(admin)* — provably-fair (commit-reveal) box outcome.
- `POST /claim` — withdraw in-game balance to the wallet (signature-verified).

## Notes (kept simple for now)

- No payout caps or SOL/stablecoin conversion yet — the reward budget tracks the
  treasury balance directly. If trading-fee income gets spiky, revisit a
  trailing-revenue cap + a reserve buffer so a volume crash can't drain it.
- Production still needs: a real DB (the skeleton uses a JSON file), buyers
  funding balances on-chain, anti-Sybil / wash-trade checks, withdrawal limits.
