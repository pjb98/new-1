/**
 * Bed Wars-lite TEAM UPGRADES UI — the diamond-economy counterpart to BwShopUI.
 *
 * Pure DOM + TypeScript (no THREE). It reads the upgrade ladder + trap catalog
 * from `bwupgrades.ts`, renders a centered modal (team upgrades on the left, the
 * trap queue on the right), and calls back to the integrator when the player
 * buys an upgrade tier or queues a trap. The integrator checks the diamond
 * wallet, deducts, advances the state, then calls `refresh()`.
 *
 * Mirrors the visual language + lifecycle of BwShopUI (injected scoped CSS,
 * Escape/backdrop dismiss, never mutates state itself).
 */

import {
  BW_UPGRADE_IDS, bwUpgradeCost, bwUpgradeMaxed, bwUpgradeLabel, bwUpgradeDesc,
  BW_TRAPS, bwNextTrapCost, BW_TRAP_QUEUE_MAX, bwTrap,
  type BwUpgradeId, type BwUpgradeState, type BwTrapId, type BwTrapQueue,
} from "./bwupgrades";

const STYLE_ID = "bw-upg-style";
const STYLE_CSS = `
#bw-upg {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center;
  background: rgba(10,16,22,0.74); backdrop-filter: blur(3px);
  z-index: 70; font-family: inherit; color: #e8f1f7;
}
#bw-upg.show { display: flex; }
#bw-upg .bu-panel {
  width: min(92vw, 820px); max-height: 86vh;
  background: rgba(26,38,50,0.97);
  border: 2px solid #6fd2ff; border-radius: 14px;
  padding: 16px; display: flex; flex-direction: column;
  box-shadow: 0 18px 60px rgba(0,0,0,0.55);
}
#bw-upg .bu-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
#bw-upg .bu-title { font-weight: 800; font-size: 20px; color: #6fd2ff; letter-spacing: 0.5px; }
#bw-upg .bu-dia {
  display: inline-flex; align-items: center; gap: 5px; margin-left: 6px;
  background: rgba(0,0,0,0.28); border: 1px solid rgba(111,210,255,0.4);
  border-radius: 999px; padding: 3px 12px; font-size: 14px; font-weight: 800;
  font-variant-numeric: tabular-nums;
}
#bw-upg .bu-dia .bu-ico { color: #8fe6ff; }
#bw-upg .bu-close {
  margin-left: auto; background: rgba(255,255,255,0.12); color: #fff;
  border: none; border-radius: 8px; width: 30px; height: 30px;
  font-size: 16px; cursor: pointer; line-height: 1;
}
#bw-upg .bu-close:hover { background: rgba(0,0,0,0.6); border: 1px solid #6fd2ff; }
#bw-upg .bu-body { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; overflow-y: auto; }
#bw-upg .bu-col-title { font-weight: 800; font-size: 13px; color: #8fe6ff; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
#bw-upg .bu-grid { display: flex; flex-direction: column; gap: 8px; }
#bw-upg .bu-card {
  background: rgba(0,0,0,0.26); border: 1.5px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 10px 11px; text-align: left;
  display: flex; flex-direction: column; gap: 4px; cursor: pointer;
  color: inherit; font: inherit; transition: transform 0.1s, border-color 0.12s, background 0.12s;
}
#bw-upg .bu-card:hover:not(.bu-locked):not(.bu-maxed) {
  border-color: rgba(111,210,255,0.65); background: rgba(111,210,255,0.06); transform: translateY(-2px);
}
#bw-upg .bu-card.bu-locked { opacity: 0.45; cursor: not-allowed; }
#bw-upg .bu-card.bu-maxed { opacity: 0.7; cursor: default; border-color: rgba(123,224,138,0.4); }
#bw-upg .bu-name { font-weight: 800; font-size: 14px; color: #fff; display: flex; justify-content: space-between; gap: 8px; }
#bw-upg .bu-cost { color: #8fe6ff; font-weight: 800; font-variant-numeric: tabular-nums; }
#bw-upg .bu-cost.bu-max { color: #7be08a; }
#bw-upg .bu-desc { font-size: 11.5px; line-height: 1.35; color: #aebfca; }
#bw-upg .bu-slots { display: flex; gap: 6px; margin-bottom: 10px; }
#bw-upg .bu-slot {
  flex: 1; height: 34px; border-radius: 8px; border: 1.5px dashed rgba(255,255,255,0.18);
  display: flex; align-items: center; justify-content: center; font-size: 18px;
  background: rgba(0,0,0,0.2);
}
#bw-upg .bu-slot.bu-filled { border-style: solid; border-color: rgba(111,210,255,0.6); background: rgba(111,210,255,0.1); }
`;

/** Glyph per trap, so a queued slot reads at a glance. */
const TRAP_ICON: Record<BwTrapId, string> = {
  itsatrap: "\u{1F578}️", // 🕸️
  counter: "\u{1F6E1}️",  // 🛡️
  alarm: "\u{1F514}",          // 🔔
  minerfatigue: "⛏️", // ⛏️
};

export class BwUpgradeUI {
  private root: HTMLElement;
  private el: HTMLElement;
  private diaEl!: HTMLElement;
  private upgEl!: HTMLElement;
  private slotsEl!: HTMLElement;
  private trapEl!: HTMLElement;

  private state: BwUpgradeState | null = null;
  private traps: BwTrapQueue | null = null;
  private diamonds = 0;
  private onBuyUpgrade?: (id: BwUpgradeId) => void;
  private onBuyTrap?: (id: BwTrapId) => void;
  private onClose?: () => void;
  private open_ = false;

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); this.close(); }
  };

  constructor(parent: HTMLElement) {
    this.root = parent;
    this.injectStyle();

    this.el = document.createElement("div");
    this.el.id = "bw-upg";
    this.el.innerHTML = `
      <div class="bu-panel">
        <div class="bu-head">
          <span class="bu-title">⚒️ Team Upgrades</span>
          <span class="bu-dia"><span class="bu-ico">◆</span><span class="bu-dia-n">0</span></span>
          <button class="bu-close" title="Close">✕</button>
        </div>
        <div class="bu-body">
          <div>
            <div class="bu-col-title">Upgrades</div>
            <div class="bu-grid bu-upg"></div>
          </div>
          <div>
            <div class="bu-col-title">Trap Queue</div>
            <div class="bu-slots"></div>
            <div class="bu-grid bu-trap"></div>
          </div>
        </div>
      </div>`;
    this.root.appendChild(this.el);

    this.diaEl = this.el.querySelector(".bu-dia-n") as HTMLElement;
    this.upgEl = this.el.querySelector(".bu-upg") as HTMLElement;
    this.slotsEl = this.el.querySelector(".bu-slots") as HTMLElement;
    this.trapEl = this.el.querySelector(".bu-trap") as HTMLElement;

    (this.el.querySelector(".bu-close") as HTMLElement).addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
  }

  get isOpen(): boolean { return this.open_; }

  open(
    state: BwUpgradeState, traps: BwTrapQueue, diamonds: number,
    onBuyUpgrade: (id: BwUpgradeId) => void, onBuyTrap: (id: BwTrapId) => void, onClose?: () => void,
  ): void {
    this.state = state; this.traps = traps; this.diamonds = diamonds;
    this.onBuyUpgrade = onBuyUpgrade; this.onBuyTrap = onBuyTrap; this.onClose = onClose;
    this.open_ = true;
    this.el.classList.add("show");
    window.addEventListener("keydown", this.onKey);
    this.render();
  }

  refresh(state: BwUpgradeState, traps: BwTrapQueue, diamonds: number): void {
    this.state = state; this.traps = traps; this.diamonds = diamonds;
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.classList.remove("show");
    window.removeEventListener("keydown", this.onKey);
    const cb = this.onClose;
    this.onBuyUpgrade = undefined; this.onBuyTrap = undefined; this.onClose = undefined;
    cb?.();
  }

  // ── rendering ───────────────────────────────────────────────────────────
  private render(): void {
    if (!this.state || !this.traps) return;
    this.diaEl.textContent = String(this.diamonds);
    this.renderUpgrades();
    this.renderSlots();
    this.renderTraps();
  }

  private renderUpgrades(): void {
    const st = this.state!;
    this.upgEl.innerHTML = BW_UPGRADE_IDS.map((id) => {
      const maxed = bwUpgradeMaxed(st, id);
      const cost = bwUpgradeCost(st, id);
      const afford = cost != null && this.diamonds >= cost;
      const cls = maxed ? "bu-maxed" : afford ? "" : "bu-locked";
      const costHtml = maxed
        ? `<span class="bu-cost bu-max">MAX</span>`
        : `<span class="bu-cost">◆ ${cost}</span>`;
      return `<button class="bu-card ${cls}" data-id="${id}" ${maxed || !afford ? "disabled" : ""}>
          <span class="bu-name">${bwUpgradeLabel(id)} ${costHtml}</span>
          <span class="bu-desc">${bwUpgradeDesc(st, id)}</span>
        </button>`;
    }).join("");
    this.upgEl.querySelectorAll<HTMLButtonElement>(".bu-card").forEach((btn) => {
      const id = btn.dataset.id as BwUpgradeId | undefined;
      if (!id) return;
      btn.addEventListener("click", () => {
        const cost = bwUpgradeCost(this.state!, id);
        if (cost != null && this.diamonds >= cost) this.onBuyUpgrade?.(id);
      });
    });
  }

  private renderSlots(): void {
    const slots = this.traps!.slots;
    let html = "";
    for (let i = 0; i < BW_TRAP_QUEUE_MAX; i++) {
      const t = slots[i];
      const ico = t ? TRAP_ICON[t] : "·";
      html += `<div class="bu-slot ${t ? "bu-filled" : ""}" title="${t ? bwTrap(t)?.name ?? "" : "Empty"}">${ico}</div>`;
    }
    this.slotsEl.innerHTML = html;
  }

  private renderTraps(): void {
    const cost = bwNextTrapCost(this.traps!.slots.length);
    const full = cost == null;
    this.trapEl.innerHTML = BW_TRAPS.map((t) => {
      const afford = !full && this.diamonds >= (cost as number);
      const cls = full ? "bu-locked" : afford ? "" : "bu-locked";
      const costHtml = full ? `<span class="bu-cost">FULL</span>` : `<span class="bu-cost">◆ ${cost}</span>`;
      return `<button class="bu-card ${cls}" data-id="${t.id}" ${afford ? "" : "disabled"}>
          <span class="bu-name">${TRAP_ICON[t.id]} ${t.name} ${costHtml}</span>
          <span class="bu-desc">${t.desc}</span>
        </button>`;
    }).join("");
    this.trapEl.querySelectorAll<HTMLButtonElement>(".bu-card").forEach((btn) => {
      const id = btn.dataset.id as BwTrapId | undefined;
      if (!id) return;
      btn.addEventListener("click", () => {
        const c = bwNextTrapCost(this.traps!.slots.length);
        if (c != null && this.diamonds >= c) this.onBuyTrap?.(id);
      });
    });
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }
}
