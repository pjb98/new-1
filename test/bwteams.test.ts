/**
 * Bed Wars-lite team/bed/win-condition state machine — src/bedwars/bwteams.ts.
 *
 * Pure logic (no THREE / no DOM), so unlike rounds.ts the real module imports
 * cleanly under the node:test runner and we exercise the ACTUAL functions
 * directly. Covers the full elimination loop: respawn-while-bed-intact,
 * eliminate-once-bed-gone, the team-out predicate, and last-team-standing /
 * draw resolution.
 *
 * Runner: `node --test --experimental-strip-types test/bwteams.test.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  breakBed,
  killPlayer,
  respawnPlayer,
  isTeamOut,
  updateMatch,
  aliveTeams,
  BW_TEAM_IDS,
  type BwTeamId,
} from "../src/bedwars/bwteams.ts";

/** A full 4-team roster, one player per team (ids 1..4). */
function fourTeamRoster() {
  const teams: BwTeamId[] = ["red", "blue", "green", "yellow"];
  return teams.map((team, i) => ({ id: i + 1, team, bot: i !== 0 }));
}

test("createMatch builds all 4 teams from the roster with intact beds + alive players", () => {
  const m = createMatch(fourTeamRoster());
  assert.deepEqual(Object.keys(m.teams).sort(), [...BW_TEAM_IDS].sort());
  for (const id of BW_TEAM_IDS) {
    const t = m.teams[id];
    assert.equal(t.bedAlive, true, `${id} bed should start intact`);
    assert.equal(t.players.length, 1, `${id} should have one player`);
    assert.equal(t.players[0].alive, true);
    assert.equal(t.players[0].eliminated, false);
  }
  // Four live teams ⇒ match ongoing.
  assert.equal(m.over, false);
  assert.equal(m.winner, null);
  assert.equal(aliveTeams(m).length, 4);
});

test("killing a player while the bed is intact → 'respawn', not eliminated, team stays in", () => {
  const m = createMatch(fourTeamRoster());
  const r = killPlayer(m, 1); // red player, red bed intact
  assert.equal(r, "respawn");
  assert.equal(m.teams.red.players[0].alive, false);
  assert.equal(m.teams.red.players[0].eliminated, false);
  assert.equal(isTeamOut(m, "red"), false);
  assert.equal(m.over, false);
});

test("respawnPlayer restores a respawning player to alive", () => {
  const m = createMatch(fourTeamRoster());
  killPlayer(m, 2);
  assert.equal(m.teams.blue.players[0].alive, false);
  respawnPlayer(m, 2);
  assert.equal(m.teams.blue.players[0].alive, true);
  assert.equal(m.teams.blue.players[0].eliminated, false);
});

test("breakBed then kill → 'eliminated' (permanent)", () => {
  const m = createMatch(fourTeamRoster());
  assert.equal(breakBed(m, "green"), true);
  const r = killPlayer(m, 3); // green player, green bed gone
  assert.equal(r, "eliminated");
  assert.equal(m.teams.green.players[0].eliminated, true);
  assert.equal(m.teams.green.players[0].alive, false);
  // An eliminated player can't be respawned.
  respawnPlayer(m, 3);
  assert.equal(m.teams.green.players[0].alive, false);
});

test("breakBed is a no-op (returns false) when the bed is already gone", () => {
  const m = createMatch(fourTeamRoster());
  assert.equal(breakBed(m, "red"), true);
  assert.equal(breakBed(m, "red"), false);
});

test("a team is OUT only once the bed is gone AND every player is eliminated", () => {
  // Two players on red so we can check the partial state.
  const m = createMatch([
    { id: 10, team: "red", bot: false },
    { id: 11, team: "red", bot: true },
    { id: 20, team: "blue", bot: false },
  ]);
  // Bed gone, but nobody dead yet → not out.
  breakBed(m, "red");
  assert.equal(isTeamOut(m, "red"), false);
  // One eliminated, one still standing → not out.
  assert.equal(killPlayer(m, 10), "eliminated");
  assert.equal(isTeamOut(m, "red"), false);
  // Both eliminated → out.
  assert.equal(killPlayer(m, 11), "eliminated");
  assert.equal(isTeamOut(m, "red"), true);
});

test("a team with no players is immediately OUT", () => {
  // Only red + blue rostered; green + yellow have empty rosters.
  const m = createMatch([
    { id: 1, team: "red", bot: false },
    { id: 2, team: "blue", bot: true },
  ]);
  assert.equal(isTeamOut(m, "green"), true);
  assert.equal(isTeamOut(m, "yellow"), true);
  assert.deepEqual(aliveTeams(m).sort(), ["blue", "red"]);
});

test("last team standing sets over + winner", () => {
  const m = createMatch(fourTeamRoster());
  // Knock out blue, green, yellow entirely.
  for (const [bed, pid] of [["blue", 2], ["green", 3], ["yellow", 4]] as const) {
    breakBed(m, bed);
    assert.equal(killPlayer(m, pid), "eliminated");
  }
  // Red alone remains.
  assert.equal(m.over, true);
  assert.equal(m.winner, "red");
  assert.deepEqual(aliveTeams(m), ["red"]);
});

test("a teams-1v1 scenario resolves a clean winner", () => {
  // Only red + yellow in play; eliminate yellow → red wins.
  const m = createMatch([
    { id: 1, team: "red", bot: false },
    { id: 2, team: "yellow", bot: true },
  ]);
  assert.equal(m.over, false);
  breakBed(m, "yellow");
  assert.equal(killPlayer(m, 2), "eliminated");
  assert.equal(m.over, true);
  assert.equal(m.winner, "red");
});

test("if the last two teams fall together it's a draw (over, winner=null)", () => {
  const m = createMatch([
    { id: 1, team: "red", bot: false },
    { id: 2, team: "blue", bot: true },
  ]);
  breakBed(m, "red");
  breakBed(m, "blue");
  killPlayer(m, 1);
  // Red is now out; blue is the lone survivor → blue wins (not a draw yet).
  assert.equal(m.winner, "blue");
  // Now blue falls too → zero teams left → draw.
  killPlayer(m, 2);
  assert.equal(m.over, true);
  assert.equal(m.winner, null);
});

test("killing an unknown id → 'noop'; killing an already-eliminated id → 'noop'", () => {
  const m = createMatch(fourTeamRoster());
  assert.equal(killPlayer(m, 999), "noop");
  breakBed(m, "red");
  assert.equal(killPlayer(m, 1), "eliminated");
  assert.equal(killPlayer(m, 1), "noop"); // already eliminated
});

test("updateMatch is idempotent and reflects the current state when called directly", () => {
  const m = createMatch(fourTeamRoster());
  updateMatch(m);
  assert.equal(m.over, false);
  // Manually wipe three teams' rosters, then recompute.
  m.teams.blue.players = [];
  m.teams.green.players = [];
  m.teams.yellow.players = [];
  updateMatch(m);
  assert.equal(m.over, true);
  assert.equal(m.winner, "red");
});
