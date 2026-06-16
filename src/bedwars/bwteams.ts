/**
 * Bed Wars-lite rules engine: the TEAM + BED + WIN-CONDITION state machine.
 *
 * Core loop (classic Bed Wars): 4 teams, each with a BED. While a team's bed is
 * intact, its players RESPAWN after dying. Once the bed is gone, a death is
 * PERMANENT (the player is eliminated). A team is OUT when its bed is gone AND
 * all its players are eliminated (or it never had any players). Last team
 * standing wins; if the last teams fall together it's a draw (no winner).
 *
 * PURE LOGIC — no three.js, no DOM. Every function mutates the passed BwMatch
 * (it's the live match state, owned by the integrator) and is otherwise
 * side-effect free, so the whole machine is unit-testable under node:test.
 */

/** The four fixed teams. Slots are constant; a team with zero players is OUT. */
export type BwTeamId = "red" | "blue" | "green" | "yellow";

/** Every team id, in canonical order — handy for createMatch + iteration. */
export const BW_TEAM_IDS: BwTeamId[] = ["red", "blue", "green", "yellow"];

/** A single combatant (human or bot) belonging to exactly one team. */
export interface BwPlayer {
  id: number; // player/bot id (unique across the match)
  team: BwTeamId;
  bot: boolean;
  alive: boolean; // currently alive (false while dead/awaiting respawn or eliminated)
  eliminated: boolean; // permanently out (died with no bed) — never respawns
}

/** One team: its bed flag plus its roster of players. */
export interface BwTeam {
  id: BwTeamId;
  bedAlive: boolean; // while true, this team's deaths are respawns, not eliminations
  players: BwPlayer[];
}

/** The live match state: the four teams plus the resolved win condition. */
export interface BwMatch {
  teams: Record<BwTeamId, BwTeam>;
  over: boolean;
  winner: BwTeamId | null; // the lone survivor, or null while ongoing / on a draw
}

/**
 * Build a fresh match from a flat roster. Always creates all four teams (a team
 * with no roster entries simply starts with an empty player list — and is
 * therefore already OUT). Every player starts alive, not eliminated, every bed
 * intact. The match's win condition is computed immediately via updateMatch.
 */
export function createMatch(roster: { id: number; team: BwTeamId; bot: boolean }[]): BwMatch {
  const teams = {} as Record<BwTeamId, BwTeam>;
  for (const id of BW_TEAM_IDS) {
    teams[id] = { id, bedAlive: true, players: [] };
  }
  for (const r of roster) {
    teams[r.team].players.push({ id: r.id, team: r.team, bot: r.bot, alive: true, eliminated: false });
  }
  const m: BwMatch = { teams, over: false, winner: null };
  updateMatch(m);
  return m;
}

/** Destroy a team's bed (no-op if already gone). Returns true if it changed. */
export function breakBed(m: BwMatch, team: BwTeamId): boolean {
  const t = m.teams[team];
  if (!t.bedAlive) return false;
  t.bedAlive = false;
  updateMatch(m);
  return true;
}

/**
 * A player died. If their bed is alive → they'll respawn (alive=false, NOT
 * eliminated); if the bed is gone → eliminated=true. Recomputes the win
 * condition afterwards. Returns:
 *   "respawn"    — death is temporary; integrator should run its respawn timer.
 *   "eliminated" — permanent; the player is out for good.
 *   "noop"       — unknown id, or the player was already eliminated.
 */
export function killPlayer(m: BwMatch, playerId: number): "respawn" | "eliminated" | "noop" {
  const p = findPlayer(m, playerId);
  if (!p || p.eliminated) return "noop";
  p.alive = false;
  const result = m.teams[p.team].bedAlive ? "respawn" : "eliminated";
  if (result === "eliminated") p.eliminated = true;
  updateMatch(m);
  return result;
}

/** Mark a player respawned (alive=true) — call after the integrator's respawn
 *  timer. No-op on an unknown or already-eliminated player (the dead stay dead). */
export function respawnPlayer(m: BwMatch, playerId: number): void {
  const p = findPlayer(m, playerId);
  if (!p || p.eliminated) return;
  p.alive = true;
}

/** Is a team fully out? True when it has no players at all, OR its bed is gone
 *  AND every one of its players is eliminated. (A team with an intact bed is
 *  never out — its dead players are merely awaiting respawn.) */
export function isTeamOut(m: BwMatch, team: BwTeamId): boolean {
  const t = m.teams[team];
  if (t.players.length === 0) return true;
  return !t.bedAlive && t.players.every((p) => p.eliminated);
}

/**
 * Recompute m.over + m.winner from current state — call after any change.
 * Looks at the set of NOT-out teams: exactly 1 left → over, that team wins;
 * 0 left → over, draw (winner=null); otherwise the match is still ongoing.
 */
export function updateMatch(m: BwMatch): void {
  const alive = aliveTeams(m);
  if (alive.length === 1) {
    m.over = true;
    m.winner = alive[0];
  } else if (alive.length === 0) {
    m.over = true;
    m.winner = null;
  } else {
    m.over = false;
    m.winner = null;
  }
}

/** Convenience: list of teams still in play (not yet OUT), in canonical order. */
export function aliveTeams(m: BwMatch): BwTeamId[] {
  return BW_TEAM_IDS.filter((id) => !isTeamOut(m, id));
}

/** Find a player by id across all teams (the rosters are small, so linear). */
function findPlayer(m: BwMatch, playerId: number): BwPlayer | undefined {
  for (const id of BW_TEAM_IDS) {
    const p = m.teams[id].players.find((x) => x.id === playerId);
    if (p) return p;
  }
  return undefined;
}
