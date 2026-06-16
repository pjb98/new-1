/**
 * WAGER — a 1v1 escrow state machine for stake-based matches (TD Duel today;
 * any head-to-head mode tomorrow). Pure logic (no THREE / DOM / network), so
 * the economics are unit-testable and currency-agnostic: amounts are integer
 * UNITS (gold now; lamports when the on-chain treasury lands).
 *
 * Flow:  create (both stakes locked into the pot)
 *          → resolve(winner)  — winner receives WINNER_SHARE of the pot,
 *                               the remainder is the treasury fee
 *          → refund()         — draw/abort: both stakes returned, no fee
 *
 * ── SOL / on-chain design (NOT implemented client-side, by design) ─────────
 * A real-money version of this CANNOT live in the client: the client decides
 * match results, so a client-side "treasury" is trivially exploitable. The
 * intended mapping when we go on-chain (devnet first):
 *   • createWager  → a Solana escrow program instruction: both wallets sign a
 *     `deposit` into a match PDA (program-derived account) holding 2×stake.
 *   • resolve      → a result attestation signed by a server-authoritative
 *     match service (or both players co-signing), then `settle` pays
 *     winner = floor(pot × WINNER_SHARE) and sweeps the fee to the treasury.
 *   • refund       → timeout/abort path: either party can trigger after a
 *     deadline if no result was attested; both deposits return in full.
 * Plus: real-money skill wagering is regulated — ship behind a compliance
 * review and a region gate. Until then this module powers GOLD wagers vs the
 * AI treasury, exercising the exact same economics end-to-end.
 */

/** Winner's share of the pot (the rest is the treasury fee). 2×stake pot →
 *  winner nets 1.8×stake, treasury keeps 0.2×stake (10% of the pot). */
export const WAGER_WINNER_SHARE = 0.9;

/** Stake presets offered by the duel lobby (gold units). */
export const WAGER_STAKES = [100, 250, 500, 1000] as const;

export type WagerState = "locked" | "resolved" | "refunded";

export interface Wager {
  id: number;
  stake: number; // per-player stake (integer units)
  pot: number; // 2 × stake, locked at creation
  players: [string, string];
  state: WagerState;
  winner: string | null; // set when resolved
}

let nextId = 1;

/** Winner's payout for a given per-player stake: floor(2·stake·share). */
export function wagerPayout(stake: number): number {
  return Math.floor(stake * 2 * WAGER_WINNER_SHARE);
}

/** Treasury fee for a given per-player stake (the pot remainder). */
export function wagerFee(stake: number): number {
  return stake * 2 - wagerPayout(stake);
}

/**
 * Open a wager: both players' stakes are considered deposited and LOCKED into
 * the pot. The caller is responsible for actually deducting `stake` from each
 * party's balance before calling (and crediting payouts/refunds after).
 * Throws on a non-positive or non-integer stake, or identical player ids.
 */
export function createWager(stake: number, a: string, b: string): Wager {
  if (!Number.isInteger(stake) || stake <= 0) throw new Error(`invalid stake: ${stake}`);
  if (a === b) throw new Error("a wager needs two distinct parties");
  return { id: nextId++, stake, pot: stake * 2, players: [a, b], state: "locked", winner: null };
}

/**
 * Resolve a locked wager: `winner` (one of the two players) receives
 * `payout` = floor(pot × share); `fee` goes to the treasury. Pure — returns the
 * settled wager plus the two amounts; the caller credits balances. Throws if
 * the wager isn't locked or the winner isn't a party to it.
 */
export function resolveWager(w: Wager, winner: string): { wager: Wager; payout: number; fee: number } {
  if (w.state !== "locked") throw new Error(`cannot resolve a ${w.state} wager`);
  if (!w.players.includes(winner)) throw new Error(`${winner} is not a party to wager ${w.id}`);
  const payout = wagerPayout(w.stake);
  return {
    wager: { ...w, state: "resolved", winner },
    payout,
    fee: w.pot - payout,
  };
}

/** Refund a locked wager (draw / abort): both stakes return in full, no fee. */
export function refundWager(w: Wager): { wager: Wager; refundEach: number } {
  if (w.state !== "locked") throw new Error(`cannot refund a ${w.state} wager`);
  return { wager: { ...w, state: "refunded", winner: null }, refundEach: w.stake };
}
