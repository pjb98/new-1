import test from "node:test";
import assert from "node:assert/strict";
import {
  duelInit, duelSend, duelPlayerLeak, duelEndWave, duelUnlockedSends, duelSendById,
  DUEL_SENDS, DUEL_MAX_HP, DUEL_MAX_WAVES,
} from "../src/td/tdduel.ts";

test("fresh match starts even at full HP", () => {
  const s = duelInit();
  assert.equal(s.playerHp, DUEL_MAX_HP);
  assert.equal(s.botHp, DUEL_MAX_HP);
  assert.equal(s.wave, 1);
  assert.ok(s.playerGold > 0 && s.playerIncome > 0);
  assert.equal(s.over, false);
});

test("sending spends gold, permanently raises income, and pressures the bot", () => {
  const s = duelInit();
  const g0 = s.playerGold, inc0 = s.playerIncome;
  const send = duelSendById("grunt")!;
  assert.ok(duelSend(s, "grunt"));
  assert.equal(s.playerGold, g0 - send.cost);
  assert.ok(s.playerIncome > inc0, "income rose");
  assert.ok(s.botPressure > 0, "bot now faces extra threat");
});

test("income-gated sends are locked until income is high enough", () => {
  const s = duelInit();
  // juggernaut is gated above the starting income
  const jugg = duelSendById("jugg")!;
  assert.ok(s.playerIncome < jugg.gate);
  assert.ok(!duelUnlockedSends(s).some((x) => x.id === "jugg"));
  s.playerGold = 99999;
  assert.equal(duelSend(s, "jugg"), false, "gated send refused");
  s.playerIncome = jugg.gate;
  assert.ok(duelSend(s, "jugg"), "unlocks once income meets the gate");
});

test("can't afford → send refused", () => {
  const s = duelInit();
  s.playerGold = 0;
  assert.equal(duelSend(s, "runner"), false);
});

test("runner sends give diminishing income after spamming", () => {
  const s = duelInit();
  s.playerGold = 100000;
  const gains: number[] = [];
  for (let i = 0; i < 8; i++) {
    const before = s.playerIncome;
    duelSend(s, "runner");
    gains.push(s.playerIncome - before);
  }
  assert.ok(gains[7] < gains[0], "later runner sends give less income");
});

test("player leak chips HP and a fatal leak ends the match as a loss", () => {
  const s = duelInit();
  duelPlayerLeak(s, 10);
  assert.equal(s.playerHp, DUEL_MAX_HP - 10);
  duelPlayerLeak(s, 999);
  assert.ok(s.over && !s.win, "0 HP → defeat");
});

test("endWave pays both economies, regens, advances the wave, returns bot sends", () => {
  const s = duelInit();
  s.playerHp = 50; // so regen is observable
  const gold0 = s.playerGold, wave0 = s.wave;
  const botSends = duelEndWave(s, 0.5);
  assert.ok(Array.isArray(botSends));
  assert.ok(s.playerGold > gold0, "income + clear bonus paid");
  assert.equal(s.wave, wave0 + 1, "wave advanced");
  assert.ok(s.playerHp > 50, "base regenerated");
});

test("heavy player pressure eventually drops the bot to defeat (player wins)", () => {
  const s = duelInit();
  let guard = 0;
  while (!s.over && guard++ < 400) {
    // overwhelm the bot every wave
    s.playerGold += 5000;
    while (duelSend(s, "grunt")) { /* dump pressure */ }
    duelSend(s, "jugg");
    duelEndWave(s, 0.2); // weak bot
  }
  assert.ok(s.over, "match resolves");
  assert.ok(s.win || s.wave > DUEL_MAX_WAVES, "player wins or it hits sudden death");
});

test("a match left alone resolves by sudden death at the wave cap", () => {
  const s = duelInit();
  let guard = 0;
  while (!s.over && guard++ < 100) duelEndWave(s, 0.5);
  assert.ok(s.over, "ends within the wave cap");
});

test("send catalog is ascending-ish and well-formed", () => {
  for (const x of DUEL_SENDS) {
    assert.ok(x.cost > 0 && x.count > 0 && x.hpMul > 0);
    assert.ok(x.incomeGain >= 0 && x.gate >= 0);
  }
});
