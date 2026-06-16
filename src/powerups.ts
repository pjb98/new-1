import { GUMS, GumDef } from "./config";

export interface ActiveGum {
  def: GumDef;
  remaining: number;
}

/**
 * Tracks active Gobblegum-style power-ups and exposes the multipliers the rest
 * of the game reads each frame. Timed gums tick down; instant gums (Full
 * Pockets) never enter the active set — the caller applies their effect once.
 */
export class Powerups {
  private active = new Map<string, ActiveGum>();

  /** Start a gum. Returns its def so the caller can handle instant effects. */
  grant(id: string): GumDef | undefined {
    const def = GUMS.find((g) => g.id === id);
    if (!def) return undefined;
    if (def.duration > 0) this.active.set(id, { def, remaining: def.duration });
    return def;
  }

  randomId(): string {
    return GUMS[Math.floor(Math.random() * GUMS.length)].id;
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  update(dt: number) {
    for (const [id, a] of this.active) {
      a.remaining -= dt;
      if (a.remaining <= 0) this.active.delete(id);
    }
  }

  clear() {
    this.active.clear();
  }

  list(): ActiveGum[] {
    return [...this.active.values()];
  }

  // ---- effect multipliers ----
  scoreMul(): number {
    return this.has("doublePoints") ? 2 : 1;
  }
  /** Insta-Kill turns every hit lethal. */
  damageMul(): number {
    return this.has("instakill") ? 100000 : 1;
  }
  fireRateMul(): number {
    return this.has("rapidFire") ? 2 : 1;
  }
  speedMul(): number {
    return this.has("sugarRush") ? 1.5 : 1;
  }
}
