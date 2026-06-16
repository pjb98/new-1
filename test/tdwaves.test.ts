import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWave, waveSize, spawnInterval, waveClearBonus, waveThreat, creepHpAt,
  TD_START_GOLD, TD_START_LIVES, TD_TOTAL_WAVES,
} from "../src/td/tdwaves.ts";

test("starting economy constants are sane", () => {
  assert.ok(TD_START_GOLD > 0 && TD_START_LIVES > 0 && TD_TOTAL_WAVES >= 10);
});

test("waves and threat grow over time", () => {
  assert.ok(creepHpAt(10) > creepHpAt(1));
  assert.ok(waveThreat(10) > waveThreat(2));
  assert.ok(waveClearBonus(10) > waveClearBonus(1));
  for (const s of buildWave(1)) assert.ok(s.hp > 0 && s.speed > 0 && s.bounty > 0);
});

test("every 5th wave is a boss wave with one big creep", () => {
  const boss = buildWave(5);
  assert.equal(boss.filter((s) => s.kind === "boss").length, 1);
  const bossHp = boss.find((s) => s.kind === "boss")!.hp;
  assert.ok(bossHp > Math.max(...buildWave(4).map((s) => s.hp)) * 3);
});

test("archetypes debut on schedule with their gating traits", () => {
  // armored (armor>0) from wave 6
  assert.equal(buildWave(5).some((s) => (s.armor ?? 0) > 0), false);
  assert.ok(buildWave(6).some((s) => (s.armor ?? 0) > 0), "armored debuts at 6");
  // camo from wave 8
  assert.ok(!buildWave(7).some((s) => s.camo), "no camo before 8");
  assert.ok(buildWave(8).some((s) => s.camo), "camo debuts at 8");
  // regrow from wave 11
  assert.ok(!buildWave(10).some((s) => (s.regen ?? 0) > 0 && s.kind === "regrow"), "no regrow before 11");
  assert.ok(buildWave(12).some((s) => (s.regen ?? 0) > 0), "regrow present by 12");
});

test("creeps carry leak damage; bosses leak harder than grunts", () => {
  const boss = buildWave(5).find((s) => s.kind === "boss")!;
  const grunt = buildWave(1)[0];
  assert.ok((boss.leakDmg ?? 1) > (grunt.leakDmg ?? 1));
});

test("spawnInterval shrinks but stays positive; waveSize matches", () => {
  assert.ok(spawnInterval(1) > spawnInterval(10) && spawnInterval(50) >= 0.32);
  assert.equal(waveSize(3), buildWave(3).length);
});
