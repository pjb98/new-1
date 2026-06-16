import test from "node:test";
import assert from "node:assert/strict";
import {
  createWager, resolveWager, refundWager, wagerPayout, wagerFee,
  WAGER_WINNER_SHARE, WAGER_STAKES,
} from "../src/wager.ts";

test("payout math: winner gets 90% of the pot, treasury keeps 10%", () => {
  assert.equal(WAGER_WINNER_SHARE, 0.9);
  for (const stake of WAGER_STAKES) {
    const pot = stake * 2;
    assert.equal(wagerPayout(stake), Math.floor(pot * 0.9));
    assert.equal(wagerFee(stake), pot - wagerPayout(stake));
    // conservation: payout + fee always equals the pot exactly
    assert.equal(wagerPayout(stake) + wagerFee(stake), pot);
  }
  // odd pots round DOWN for the winner; the treasury absorbs the remainder
  assert.equal(wagerPayout(5), 9); // pot 10 → 9
  assert.equal(wagerFee(5), 1);
});

test("createWager locks both stakes into the pot", () => {
  const w = createWager(250, "you", "bot");
  assert.equal(w.pot, 500);
  assert.equal(w.state, "locked");
  assert.equal(w.winner, null);
  assert.deepEqual(w.players, ["you", "bot"]);
});

test("createWager rejects bad stakes and self-wagers", () => {
  assert.throws(() => createWager(0, "a", "b"));
  assert.throws(() => createWager(-50, "a", "b"));
  assert.throws(() => createWager(10.5, "a", "b"));
  assert.throws(() => createWager(100, "a", "a"));
});

test("resolve pays the winner and the fee; settles exactly once", () => {
  const w = createWager(500, "you", "bot");
  const r = resolveWager(w, "you");
  assert.equal(r.wager.state, "resolved");
  assert.equal(r.wager.winner, "you");
  assert.equal(r.payout, 900); // 1.8× the 500 stake
  assert.equal(r.fee, 100);    // 10% of the 1000 pot
  // no double-settles, no settling the original mutated (it's pure)
  assert.equal(w.state, "locked");
  assert.throws(() => resolveWager(r.wager, "you"));
  assert.throws(() => refundWager(r.wager));
});

test("resolve rejects a non-party winner", () => {
  const w = createWager(100, "you", "bot");
  assert.throws(() => resolveWager(w, "stranger"));
});

test("refund returns both stakes in full with no fee", () => {
  const w = createWager(1000, "you", "bot");
  const r = refundWager(w);
  assert.equal(r.wager.state, "refunded");
  assert.equal(r.refundEach, 1000);
  assert.throws(() => resolveWager(r.wager, "you"));
});
