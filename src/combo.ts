/**
 * Kill-combo multiplier. Chaining kills within a short window ramps a points
 * multiplier (x1 → x5); letting the timer lapse resets it. Layers an arcade
 * skill loop on top of the existing economy with almost no new state.
 */
const WINDOW = 3.5; // seconds before the chain decays
const TIERS = [1, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5]; // kills→multiplier curve

export class Combo {
  count = 0;
  private timer = 0;
  /** Extra seconds added to the decay window by upgrades. */
  windowBonus = 0;

  private get window(): number {
    return WINDOW + this.windowBonus;
  }

  /** Register a kill. Returns the current multiplier to apply to its score. */
  onKill(): number {
    this.count++;
    this.timer = this.window;
    return this.multiplier;
  }

  get multiplier(): number {
    return TIERS[Math.min(this.count, TIERS.length - 1)];
  }

  /** True while a meaningful chain (x1.25+) is active, for HUD display. */
  get active(): boolean {
    return this.count >= 2 && this.timer > 0;
  }

  /** Fraction of the window remaining (for a draining HUD bar). */
  get fraction(): number {
    return Math.max(0, this.timer / this.window);
  }

  update(dt: number) {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.count = 0;
    }
  }

  reset() {
    this.count = 0;
    this.timer = 0;
  }
}
