/**
 * Bed Wars-lite SHOP UI — a self-managed DOM overlay over the HUD root.
 *
 * Pure DOM + TypeScript (no THREE). It owns nothing about the economy: it reads
 * the catalog + affordability helpers from `bwshop.ts`, renders a centered modal
 * (category pill tabs + a card grid), and calls back to the integrator on a buy.
 * The integrator deducts/applies, then calls `refresh()` with the new wallet.
 *
 * Driving it:
 *   const ui = new BwShopUI(document.getElementById("ui")!);
 *   ui.open(wallet, (item) => {            // affordable card clicked
 *     const next = bwBuy(wallet, item);    // integrator deducts + applies effect
 *     wallet = next;
 *     ui.refresh(wallet);                  // re-render chips + affordability
 *   }, () => { ...closed... });
 *
 * Visual language mirrors #pet-index in style.css (dark warm panel, gold accents,
 * rounded corners, pill tabs). CSS is injected once, scoped under #bw-shop.
 */

import { bwCanAfford, bwShopByCategory } from "./bwshop";
import type { BwShopItem, BwWallet, BwResource } from "./bwshop";

/** Resource → display chip glyph. Matches the brief (⛓ iron / ⛀ gold / ✦ emerald). */
const RES_ICON: Record<BwResource, string> = {
  iron: "⛓",     // ⛓
  gold: "⛀",     // ⛀
  diamond: "◆",  // ◆
  emerald: "✦",  // ✦
};
const RES_ORDER: BwResource[] = ["iron", "gold", "diamond", "emerald"];
const RES_LABEL: Record<BwResource, string> = { iron: "Iron", gold: "Gold", diamond: "Diamond", emerald: "Emerald" };

const STYLE_ID = "bw-shop-style";
const STYLE_CSS = `
#bw-shop {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center;
  background: rgba(20,14,10,0.74); backdrop-filter: blur(3px);
  z-index: 70; font-family: inherit; color: #f3e9d8;
}
#bw-shop.show { display: flex; }
#bw-shop .bw-panel {
  width: min(90vw, 860px); max-height: 86vh;
  background: rgba(46,36,26,0.97);
  border: 2px solid #ffd24a; border-radius: 14px;
  padding: 16px; display: flex; flex-direction: column;
  box-shadow: 0 18px 60px rgba(0,0,0,0.55);
}
#bw-shop .bw-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
#bw-shop .bw-title { font-weight: 800; font-size: 20px; color: #ffd24a; letter-spacing: 0.5px; }
#bw-shop .bw-wallet { display: flex; gap: 6px; margin-left: 6px; }
#bw-shop .bw-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(0,0,0,0.28); border: 1px solid rgba(255,210,74,0.35);
  border-radius: 999px; padding: 3px 10px; font-size: 13px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
#bw-shop .bw-chip .bw-ico { color: #ffd24a; }
#bw-shop .bw-close {
  margin-left: auto; background: rgba(255,255,255,0.12); color: #fff;
  border: none; border-radius: 8px; width: 30px; height: 30px;
  font-size: 16px; cursor: pointer; line-height: 1;
}
#bw-shop .bw-close:hover { background: rgba(0,0,0,0.6); border: 1px solid #ffd24a; }
#bw-shop .bw-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
#bw-shop .bw-tab {
  background: rgba(255,255,255,0.06); color: #cbb89a;
  border: 1px solid rgba(255,255,255,0.1); border-radius: 999px;
  padding: 5px 14px; font-size: 13px; font-weight: 700; cursor: pointer;
  text-transform: capitalize; transition: background 0.12s, color 0.12s, border-color 0.12s;
}
#bw-shop .bw-tab:hover { background: rgba(255,255,255,0.12); color: #fff; }
#bw-shop .bw-tab.active {
  background: rgba(255,210,74,0.18); border-color: rgba(255,210,74,0.6); color: #ffd24a;
}
#bw-shop .bw-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 10px; overflow-y: auto; padding: 2px; align-content: start;
}
#bw-shop .bw-card {
  background: rgba(0,0,0,0.26); border: 1.5px solid rgba(255,255,255,0.1);
  border-radius: 12px; padding: 10px 11px; text-align: left;
  display: flex; flex-direction: column; gap: 5px; cursor: pointer;
  color: inherit; font: inherit; transition: transform 0.1s, border-color 0.12s, background 0.12s;
}
#bw-shop .bw-card:hover:not(.bw-locked) {
  border-color: rgba(255,210,74,0.65); background: rgba(255,210,74,0.06);
  transform: translateY(-2px);
}
#bw-shop .bw-card.bw-locked { opacity: 0.42; cursor: not-allowed; }
#bw-shop .bw-name { font-weight: 800; font-size: 14px; color: #fff; }
#bw-shop .bw-desc { font-size: 11.5px; line-height: 1.35; color: #cbb89a; flex: 1; }
#bw-shop .bw-cost { display: flex; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
#bw-shop .bw-cost .bw-chip { padding: 2px 8px; font-size: 12px; }
#bw-shop .bw-empty { color: #cbb89a; font-size: 13px; padding: 20px; text-align: center; grid-column: 1 / -1; }
`;

export class BwShopUI {
  private root: HTMLElement;
  private el: HTMLElement;
  private walletEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private gridEl!: HTMLElement;

  private wallet: BwWallet = { iron: 0, gold: 0, diamond: 0, emerald: 0 };
  private onBuy?: (item: BwShopItem) => void;
  private onClose?: () => void;
  private activeCategory = "";
  private open_ = false;

  // bound so add/removeEventListener pair up
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  constructor(parent: HTMLElement) {
    this.root = parent;
    this.injectStyle();

    this.el = document.createElement("div");
    this.el.id = "bw-shop";
    this.el.innerHTML = `
      <div class="bw-panel">
        <div class="bw-head">
          <span class="bw-title">\u{1F6D2} Bed Wars Shop</span>
          <span class="bw-wallet"></span>
          <button class="bw-close" title="Close">✕</button>
        </div>
        <div class="bw-tabs"></div>
        <div class="bw-grid"></div>
      </div>`;
    this.root.appendChild(this.el);

    this.walletEl = this.el.querySelector(".bw-wallet") as HTMLElement;
    this.tabsEl = this.el.querySelector(".bw-tabs") as HTMLElement;
    this.gridEl = this.el.querySelector(".bw-grid") as HTMLElement;

    // ✕ button + backdrop click both dismiss.
    (this.el.querySelector(".bw-close") as HTMLElement).addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(wallet: BwWallet, onBuy: (item: BwShopItem) => void, onClose?: () => void): void {
    this.wallet = wallet;
    this.onBuy = onBuy;
    this.onClose = onClose;
    // Default to the first category each open (or keep a still-valid one).
    const groups = bwShopByCategory();
    if (!groups.some((g) => g.category === this.activeCategory)) {
      this.activeCategory = groups.length ? groups[0].category : "";
    }
    this.open_ = true;
    this.el.classList.add("show");
    window.addEventListener("keydown", this.onKey);
    this.renderTabs();
    this.renderWallet();
    this.renderGrid();
  }

  refresh(wallet: BwWallet): void {
    this.wallet = wallet;
    this.renderWallet();
    this.renderGrid();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.classList.remove("show");
    window.removeEventListener("keydown", this.onKey);
    const cb = this.onClose;
    this.onBuy = undefined;
    this.onClose = undefined;
    cb?.();
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private renderWallet(): void {
    this.walletEl.innerHTML = RES_ORDER
      .map(
        (r) =>
          `<span class="bw-chip" title="${RES_LABEL[r]}"><span class="bw-ico">${RES_ICON[r]}</span>${this.wallet[r] ?? 0}</span>`,
      )
      .join("");
  }

  private renderTabs(): void {
    const groups = bwShopByCategory();
    this.tabsEl.innerHTML = groups
      .map(
        (g) =>
          `<button class="bw-tab ${g.category === this.activeCategory ? "active" : ""}" data-cat="${g.category}">${g.category}</button>`,
      )
      .join("");
    this.tabsEl.querySelectorAll<HTMLButtonElement>(".bw-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        if (!cat || cat === this.activeCategory) return;
        this.activeCategory = cat;
        this.tabsEl.querySelectorAll(".bw-tab").forEach((b) => b.classList.toggle("active", b === btn));
        this.renderGrid();
      });
    });
  }

  private renderGrid(): void {
    const group = bwShopByCategory().find((g) => g.category === this.activeCategory);
    const items = group ? group.items : [];
    if (!items.length) {
      this.gridEl.innerHTML = `<div class="bw-empty">Nothing for sale here.</div>`;
      return;
    }
    this.gridEl.innerHTML = items.map((it) => this.cardHtml(it)).join("");
    this.gridEl.querySelectorAll<HTMLButtonElement>(".bw-card").forEach((btn) => {
      const id = btn.dataset.id;
      if (!id) return;
      const item = items.find((i) => i.id === id);
      if (!item) return;
      btn.addEventListener("click", () => {
        // Only affordable cards fire onBuy; unaffordable ones are disabled.
        if (bwCanAfford(this.wallet, item)) this.onBuy?.(item);
      });
    });
  }

  private cardHtml(item: BwShopItem): string {
    const affordable = bwCanAfford(this.wallet, item);
    const cost = (Object.keys(item.cost) as BwResource[])
      .filter((r) => (item.cost[r] ?? 0) > 0)
      .map(
        (r) =>
          `<span class="bw-chip" title="${RES_LABEL[r]}"><span class="bw-ico">${RES_ICON[r]}</span>${item.cost[r]}</span>`,
      )
      .join("");
    return `<button class="bw-card ${affordable ? "" : "bw-locked"}" data-id="${item.id}" ${affordable ? "" : "disabled"}>
        <span class="bw-name">${item.name}</span>
        <span class="bw-desc">${item.desc}</span>
        <span class="bw-cost">${cost}</span>
      </button>`;
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }
}
