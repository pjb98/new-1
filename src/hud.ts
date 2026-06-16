import { ActiveGum } from "./powerups";
import { Tier } from "./upgrades";
import { ModDelta } from "./mods";

/** A meta-upgrade row as the HUD needs to render it. */
export interface MetaRow {
  id: string;
  name: string;
  desc: string;
  cost: number;
  owned: boolean;
  affordable: boolean;
}

/** A cosmetic skin row for the skins tab. */
export interface SkinRow {
  id: string;
  name: string;
  body: number;
  head: number;
  cost: number;
  owned: boolean;
  equipped: boolean;
  affordable: boolean;
  rarity: string;
  rarityColor: string;
  thumb?: string; // data-URL preview of the hero in this skin
}

/** A challenge row for the challenges tab. */
export interface ChallengeRow {
  name: string;
  desc: string;
  reward: number;
  progress: number;
  goal: number;
  done: boolean;
}

/** One pet row in the Pets shop tab (view-model built by the game). */
export interface PetRow {
  id: string; name: string; desc: string; cost: number; color: string;
  owned: boolean; level: number; upCost: number; affordable: boolean;
  xp?: number; xpNext?: number; // combat-XP progress toward the next level
  stage?: number; stageName?: string; // evolution stage (0-based) + its label
  rarity: string; rarityColor: string; ability?: string;
  stats?: { label: string; value: string }[]; // combat stats shown on the card
  thumb?: string; // data-URL preview of the pet's voxel model (see petthumb.ts)
  trial?: { label: string; cur: number; goal: number; done: boolean }[];
  // ── PET DEPTH: collection/role display ──
  roleIcon?: string; roleLabel?: string; // combat-role verb badge
  stars?: number; maxStars?: number; // dupe→star ascension
  shiny?: boolean; // cosmetic chroma variant
  canStar?: boolean; starCost?: number; // a dupe is available to convert into a star
  active?: boolean; // currently in the live combat squad
  canSquad?: boolean; // an owned combat pet that can be deployed/benched
  benched?: boolean; // owned but sat out of the squad
}

/** Active-squad role tally + synergy bonuses for the Pets tab header. */
export interface PetSquadInfo {
  roles: { role: string; icon: string; label: string; count: number }[];
  bonuses: string[];
  collected: number;
  total: number;
  nextMilestone?: { own: number; essence: number };
  members?: { id: string; name: string; icon: string; color: string }[]; // the active squad
  cap?: number; // max active combat pets
}

/** One level-up card as the HUD renders it (view-model built by the game). */
export interface LevelCardVM {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  tier: Tier;
  deltas: ModDelta[];
}

export interface LevelUpInfo {
  level: number;
  cards: LevelCardVM[];
  rerollCost: number;
  canReroll: boolean;
  onPick: (id: string) => void;
  onReroll: () => void;
}

/** DOM-based HUD + overlays. Cheap, crisp, and easy to restyle. */
export class Hud {
  private root: HTMLElement;
  private roundEl!: HTMLElement;
  private pointsEl!: HTMLElement;
  private healthFill!: HTMLElement;
  private weaponName!: HTMLElement;
  private weaponAmmo!: HTMLElement;
  private promptEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private powerupsEl!: HTMLElement;
  private startOverlay!: HTMLElement;
  private overOverlay!: HTMLElement;
  private overStats!: HTMLElement;

  private toastTimer?: number;
  // Cached last-rendered values so the per-frame HUD updates skip redundant
  // string building + DOM writes (these methods are called every frame).
  private _cPoints = NaN;
  private _cHpPct = -1;
  private _cWeapon = "";
  private _cAmmo = -1;
  private _cReserve = "";
  private _cReloading = false;
  private _cComboMult = -1;
  private _cComboFrac = -1;
  private _cPowerSig = "";

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  private build() {
    this.root.innerHTML = `
      <div id="wallet-pill" class="hidden">🔗 <span id="wallet-pill-addr"></span></div>
      <div class="hud-top">
        <div class="pill round"><span class="pico">🌊</span><span class="label">Round</span><span class="value" id="hud-round">1</span></div>
        <div class="pill points"><span class="pico">⭐</span><span class="label">Points</span><span class="value" id="hud-points">0</span></div>
        <div class="pill room hidden" id="hud-room"><span class="pico">🚪</span><span class="label">Room</span><span class="value" id="hud-room-code"></span></div>
      </div>
      <div class="powerups" id="hud-powerups"></div>
      <div class="combo" id="hud-combo">
        <span class="combo-x" id="hud-combo-x">x2</span>
        <div class="combo-bar"><div class="combo-fill" id="hud-combo-fill"></div></div>
      </div>
      <div id="rampage" class="hidden">
        <span id="rampage-x">×1.0</span>
        <div class="rampage-bar"><div id="rampage-fill"></div></div>
      </div>
      <div class="bossbar hidden" id="hud-boss">
        <div class="boss-name" id="hud-boss-name">BOSS</div>
        <div class="boss-track"><div class="boss-fill" id="hud-boss-fill"></div></div>
      </div>
      <div class="hud-bottom">
        <div class="health"><div class="bar"><div class="fill" id="hud-health"></div></div></div>
        <div class="weapon">
          <div class="name" id="hud-weapon-name">Peashooter</div>
          <div class="ammo"><span id="hud-ammo">12</span> <span class="reserve">/ <span id="hud-reserve">∞</span></span></div>
          <div class="reloading" id="hud-reloading"></div>
        </div>
      </div>
      <div id="overdrive" class="hidden">⏩ 2× OVERDRIVE</div>
      <div id="prompt"></div>
      <div id="toast"></div>
      <div id="island-bar" class="hidden">
        <span class="island-tip">🏝️ Walk up to a glowing pad · <b>E</b> to use</span>
        <button class="coop-btn" id="btn-leave-island">Leave Island</button>
      </div>
      <div id="build-bar" class="hidden"></div>

      <div class="overlay splash" id="overlay-start">
        <button class="overlay-close" id="overlay-close" title="Back to island">✕</button>
        <div class="splash-hero">
          <img class="splash-logo" src="/logo.png" alt="Tiny Realm" />
          <img class="splash-art" src="/hero.png" alt="" />
          <p class="tagline">A tiny voxel world you can actually play. Survive, build, raid, collect — every run earns <b>$TINY</b>.</p>
          <div class="bestline" id="best-line"></div>
          <!-- Primary actions FIRST so they're always visible without scrolling past the shop. -->
          <button class="play" id="btn-connect">🔗 Connect Wallet</button>
          <button class="play" id="btn-island">🏝️ Enter Island</button>
          <button class="play secondary" id="btn-start">▶ Play Solo</button>
        </div>
        <div class="coop">
          <button class="coop-btn" id="btn-host">Host Co-op</button>
          <div class="join-row">
            <input id="join-code" maxlength="4" placeholder="CODE" autocomplete="off" />
            <button class="coop-btn" id="btn-join">Join</button>
          </div>
        </div>
        <div class="lobby-status" id="lobby-status"></div>
        <div class="shop">
          <div class="shop-bar">
            <div class="shop-tabs">
              <button class="shop-tab active" data-tab="upgrades">Upgrades</button>
              <button class="shop-tab" data-tab="skins">Skins</button>
              <button class="shop-tab" data-tab="challenges">Challenges</button>
              <button class="shop-tab" data-tab="market">Market</button>
              <button class="shop-tab" data-tab="pets">Pets</button>
            </div>
            <span class="shop-essence">✦ <span id="essence-bal">0</span></span>
            <span class="shop-essence" id="prestige-chip" title="Ascension multiplier" style="margin-left:8px;cursor:pointer;">✦✦ <span id="prestige-bal">0</span> <span id="prestige-mul" style="opacity:0.8;">(x1.00)</span></span>
            <span class="shop-essence" id="streak-chip" title="Login streak" style="margin-left:8px;">🔥 <span id="streak-count">0</span>d</span>
          </div>
          <div class="tab" id="tab-upgrades"></div>
          <div class="tab hidden" id="tab-skins"></div>
          <div class="tab hidden" id="tab-challenges"></div>
          <div class="tab hidden" id="tab-market"></div>
          <div class="tab hidden" id="tab-pets"></div>
        </div>
        <div id="daily-board"></div>
        <details class="controls-fold">
          <summary>Controls</summary>
          <div class="controls">
            <span class="k">WASD</span><span>Move</span>
            <span class="k">Mouse</span><span>Aim</span>
            <span class="k">Click</span><span>Fire</span>
            <span class="k">R</span><span>Reload</span>
            <span class="k">E</span><span>Buy / interact</span>
            <span class="k">Q</span><span>Swap weapon</span>
            <span class="k">P</span><span>Pause</span>
            <span class="k">M</span><span>Mute</span>
            <span class="k">F</span><span>Nuke (when charged)</span>
            <span class="k">T</span><span>Emote (island)</span>
            <span class="k">R</span><span>Rotate part (build)</span>
            <span class="k">Z</span><span>Undo (build)</span>
          </div>
        </details>
        <div class="wallet-row">
          <button class="coop-btn wallet" id="btn-wallet">Connect Wallet</button>
          <span class="wallet-bal" id="wallet-bal"></span>
        </div>
        <div class="wallet-row claim-row hidden" id="claim-row">
          <button class="coop-btn" id="btn-claim">Claim $TINY</button>
          <button class="link-btn" id="btn-token-api" title="Token reward backend">⚙</button>
          <span class="wallet-bal" id="claim-status"></span>
        </div>
        <button class="link-btn" id="btn-server">⚙ Co-op server</button>
      </div>

      <div class="overlay hidden" id="overlay-over">
        <h1>YOU <span class="dead">DIED</span></h1>
        <div class="overStats" id="over-stats"></div>
        <div class="over-buttons">
          <button class="play" id="btn-restart">Again</button>
          <button class="coop-btn" id="btn-menu">🏝️ Lobby</button>
        </div>
      </div>

      <div class="overlay levelup hidden" id="overlay-levelup">
        <div class="lvl-burst" id="lvl-burst"></div>
        <h1 class="lvl-title">LEVEL <span class="dead">UP</span><span class="lvl-num" id="lvl-num"></span></h1>
        <p class="lvl-sub">Choose your upgrade — <span class="key">1</span><span class="key">2</span><span class="key">3</span> or click</p>
        <div class="cards" id="levelup-cards"></div>
        <div class="lvl-foot">
          <button class="reroll" id="btn-reroll"><span class="rr-ico">🎲</span> <span id="rr-label">Reroll</span></button>
        </div>
      </div>
    `;

    this.roundEl = this.q("#hud-round");
    this.pointsEl = this.q("#hud-points");
    this.healthFill = this.q("#hud-health");
    this.weaponName = this.q("#hud-weapon-name");
    this.weaponAmmo = this.q("#hud-ammo");
    this.promptEl = this.q("#prompt");
    this.toastEl = this.q("#toast");
    this.powerupsEl = this.q("#hud-powerups");
    this.startOverlay = this.q("#overlay-start");
    this.overOverlay = this.q("#overlay-over");
    this.overStats = this.q("#over-stats");

    // ✕ on the shop-modal: close back to the island
    this.q("#overlay-close").addEventListener("click", () => this.hideStart());
    // clicking the dark backdrop (outside the card) also closes the shop modal
    this.startOverlay.addEventListener("click", (e) => {
      if (e.target === this.startOverlay && this.startOverlay.classList.contains("shop-modal")) this.hideStart();
    });

    // menu shop tab switching
    this.root.querySelectorAll<HTMLButtonElement>(".shop-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab!;
        this.root.querySelectorAll(".shop-tab").forEach((b) => b.classList.toggle("active", b === btn));
        for (const name of ["upgrades", "skins", "challenges", "market", "pets"]) {
          this.q(`#tab-${name}`).classList.toggle("hidden", name !== tab);
        }
      });
    });
  }

  private q(sel: string): HTMLElement {
    const el = this.root.querySelector(sel);
    if (!el) throw new Error(`HUD element missing: ${sel}`);
    return el as HTMLElement;
  }

  onStart(cb: () => void) {
    this.q("#btn-start").addEventListener("click", cb);
  }
  onRestart(cb: () => void) {
    this.q("#btn-restart").addEventListener("click", cb);
  }
  onMenu(cb: () => void) {
    this.q("#btn-menu").addEventListener("click", cb);
  }
  onHost(cb: () => void) {
    this.q("#btn-host").addEventListener("click", cb);
  }
  onIsland(cb: () => void) {
    this.q("#btn-island").addEventListener("click", cb);
  }
  /** Toggle the on-island HUD affordances (a small "leave island" control). */
  setIslandMode(on: boolean) {
    this.q("#island-bar").classList.toggle("hidden", !on);
    // hide all the gameplay HUD (round/points/health/weapon/combo/…) in the hub;
    // CSS keys off this class so only the lobby chrome (prompt/toast/island bar)
    // stays up. See `.island-mode` rules in style.css.
    this.root.classList.toggle("island-mode", on);
  }
  onLeaveIsland(cb: () => void) {
    this.q("#btn-leave-island").addEventListener("click", cb);
  }
  /** Open the shop as a focused MODAL over the island (no menu/Play chrome — you're
   *  already in the hub). `tab` jumps to a tab; `petsOnly` shows just the Pets
   *  panel (used by the Pet Sanctuary). A ✕ closes back to the island. */
  openShop(tab?: string, soloTab = false) {
    this.startOverlay.classList.remove("hidden", "splash");
    this.startOverlay.classList.add("shop-modal");
    this.startOverlay.classList.toggle("solo-tab", soloTab);
    if (tab) {
      this.root.querySelectorAll<HTMLButtonElement>(".shop-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === tab));
      for (const name of ["upgrades", "skins", "challenges", "market", "pets"]) {
        this.q(`#tab-${name}`).classList.toggle("hidden", name !== tab);
      }
    }
  }
  /** Full build UI: category tabs + part chips + colour swatches + a tool row
   *  (rotate / paint / undo / done). Everything is an on-screen button so it
   *  works on touch as well as keyboard. */
  showBuildBar(opts: {
    cats: { id: string; label: string }[];
    parts: { kind: string; label: string; color: number; cat: string }[];
    swatches: number[];
    activeCat: string;
    activePart: string;
    activeColor: number | null;
    paint: boolean;
    onPickCat: (id: string) => void;
    onPickPart: (kind: string) => void;
    onPickColor: (color: number | null) => void;
    onRotate: () => void;
    onTogglePaint: () => void;
    onUndo: () => void;
    onDone: () => void;
  }) {
    const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
    const bar = this.q("#build-bar");
    bar.classList.remove("hidden");
    const tabs = opts.cats
      .map((c) => `<button class="build-tab ${c.id === opts.activeCat ? "active" : ""}" data-cat="${c.id}">${c.label}</button>`)
      .join("");
    const chips = opts.parts
      .filter((p) => p.cat === opts.activeCat)
      .map(
        (p) => `<button class="build-swatch ${p.kind === opts.activePart ? "active" : ""}" data-kind="${p.kind}"><span class="sw" style="background:${hex(p.color)}"></span>${p.label}</button>`,
      )
      .join("");
    const swatches =
      `<button class="build-color ${opts.activeColor === null ? "active" : ""}" data-color="auto" title="default colour">auto</button>` +
      opts.swatches
        .map((c) => `<button class="build-color ${c === opts.activeColor ? "active" : ""}" data-color="${c}" style="background:${hex(c)}"></button>`)
        .join("");
    const tools =
      `<button class="build-tool" data-tool="rotate">\u27f3 Rotate (R)</button>` +
      `<button class="build-tool ${opts.paint ? "active" : ""}" data-tool="paint">Paint</button>` +
      `<button class="build-tool" data-tool="undo">Undo</button>` +
      `<button class="build-tool done" data-tool="done">Done</button>`;
    bar.innerHTML =
      `<div class="build-tabs">${tabs}</div>` +
      `<div class="build-chips">${chips}</div>` +
      `<div class="build-colors">${swatches}</div>` +
      `<div class="build-tools">${tools}</div>`;
    bar.querySelectorAll<HTMLButtonElement>(".build-tab").forEach((b) =>
      b.addEventListener("click", () => opts.onPickCat(b.dataset.cat!)),
    );
    bar.querySelectorAll<HTMLButtonElement>(".build-swatch").forEach((b) =>
      b.addEventListener("click", () => { if (b.dataset.kind) opts.onPickPart(b.dataset.kind); }),
    );
    bar.querySelectorAll<HTMLButtonElement>(".build-color").forEach((b) =>
      b.addEventListener("click", () => opts.onPickColor(b.dataset.color === "auto" ? null : Number(b.dataset.color))),
    );
    bar.querySelectorAll<HTMLButtonElement>(".build-tool").forEach((b) =>
      b.addEventListener("click", () => {
        const t = b.dataset.tool;
        if (t === "rotate") opts.onRotate();
        else if (t === "paint") opts.onTogglePaint();
        else if (t === "undo") opts.onUndo();
        else if (t === "done") opts.onDone();
      }),
    );
  }
  hideBuildBar() {
    this.q("#build-bar").classList.add("hidden");
  }

  /** Pet picker for the "Pet Perch" part. */
  showPetPicker(pets: { id: string; name: string; color: string }[], active: string, onPick: (id: string) => void) {
    let box = document.getElementById("pet-picker");
    if (!box) {
      box = document.createElement("div");
      box.id = "pet-picker";
      this.root.appendChild(box);
    }
    box.style.display = "block";
    box.innerHTML =
      `<div class="pet-picker-title">Display pet</div>` +
      `<div class="pet-picker-row">` +
      pets
        .map((p) => `<button class="pet-pick ${p.id === active ? "active" : ""}" data-id="${p.id}" style="--chip:${p.color}">${p.name}</button>`)
        .join("") +
      `</div>`;
    box.querySelectorAll<HTMLButtonElement>(".pet-pick").forEach((b) =>
      b.addEventListener("click", () => {
        box!.querySelectorAll(".pet-pick").forEach((o) => o.classList.toggle("active", o === b));
        if (b.dataset.id) onPick(b.dataset.id);
      }),
    );
  }
  hidePetPicker() {
    const box = document.getElementById("pet-picker");
    if (box) box.style.display = "none";
  }

  /** "Tiny Home Academy" results card shown when leaving build mode. */
  showHouseRating(
    r: { score: number; grade: string; breakdown: { label: string; score: number; max: number; note: string }[] },
    onClose: () => void,
  ) {
    let ov = document.getElementById("house-rating");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "house-rating";
      this.root.appendChild(ov);
    }
    const lines = r.breakdown
      .map((b) => `<div class="hr-line"><span>${b.label}</span><b>${b.score}/${b.max}</b><small>${b.note}</small></div>`)
      .join("");
    ov.style.display = "flex";
    ov.innerHTML =
      `<div class="hr-card"><div class="hr-title">Tiny Home Academy</div>` +
      `<div class="hr-grade hr-${r.grade}">${r.grade}</div>` +
      `<div class="hr-score">${r.score} / 100</div>` +
      `<div class="hr-lines">${lines}</div>` +
      `<button class="hr-close">Nice!</button></div>`;
    (ov.querySelector(".hr-close") as HTMLButtonElement).addEventListener("click", () => {
      this.hideHouseRating();
      onClose();
    });
  }
  hideHouseRating() {
    const ov = document.getElementById("house-rating");
    if (ov) ov.style.display = "none";
  }

  /** "Likes/visits" chip shown while visiting a neighbour's plot. */
  showPlotMeta(likes: number, visits: number) {
    let el = document.getElementById("plot-meta");
    if (!el) {
      el = document.createElement("div");
      el.id = "plot-meta";
      this.root.appendChild(el);
    }
    el.style.display = "block";
    el.textContent = `\u2764 ${likes} \u00b7 ${visits} ${visits === 1 ? "visit" : "visits"} \u00b7 [L] like`;
  }
  hidePlotMeta() {
    const el = document.getElementById("plot-meta");
    if (el) el.style.display = "none";
  }

  /** Render the persistent best-run line on the menu. */
  setBest(round: number, score: number) {
    const el = this.q("#best-line");
    el.innerHTML = round > 0 ? `Best run · <b>Round ${round}</b> · ${score} pts` : "No runs yet — go make a mess.";
  }

  private setEssenceBalance(essence: number) {
    this.q("#essence-bal").textContent = String(essence);
  }

  /** Render the meta-upgrade shop tab. `onBuy` fires with the chosen id. */
  renderMeta(essence: number, rows: MetaRow[], onBuy: (id: string) => void) {
    this.setEssenceBalance(essence);
    const tab = this.q("#tab-upgrades");
    tab.innerHTML = `<div class="meta-grid">
        ${rows
          .map(
            (r) => `<button class="meta-card ${r.owned ? "owned" : r.affordable ? "" : "locked"}" data-id="${r.id}" ${r.owned ? "disabled" : ""}>
              <span class="m-name">${r.name}</span>
              <span class="m-desc">${r.desc}</span>
              <span class="m-cost">${r.owned ? "OWNED" : `✦ ${r.cost}`}</span>
            </button>`,
          )
          .join("")}
      </div>`;
    tab.querySelectorAll<HTMLButtonElement>(".meta-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (id) onBuy(id);
      });
    });
  }

  /** Render the cosmetic skins tab — a rarity-grouped grid of hero previews with
   *  owned/equipped state + completion header. Click = equip (if owned) or buy. */
  renderSkins(essence: number, rows: SkinRow[], onSelect: (id: string) => void) {
    this.setEssenceBalance(essence);
    const order = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
    const label = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
    const card = (r: SkinRow) => {
      const cls = r.equipped ? "equipped" : r.owned ? "owned" : r.affordable ? "" : "locked";
      const tag = r.equipped ? "✓ EQUIPPED" : r.owned ? "EQUIP" : `✦ ${r.cost}`;
      const b = `#${r.body.toString(16).padStart(6, "0")}`;
      const h = `#${r.head.toString(16).padStart(6, "0")}`;
      const stage = r.thumb
        ? `<div class="skin-stage"><img class="skin-preview" src="${r.thumb}" alt="" loading="lazy" /></div>`
        : `<div class="skin-stage"><span class="skin-fig"><span class="skin-head" style="background:${h}"></span><span class="skin-body" style="background:${b}"></span></span></div>`;
      return `<button class="skin-card ${cls}" data-id="${r.id}" style="--rc:${r.rarityColor}">
          ${stage}
          <span class="skin-name">${r.name}</span>
          <span class="skin-rarity" style="color:${r.rarityColor}">${label(r.rarity)}</span>
          <span class="skin-tag">${tag}</span>
        </button>`;
    };
    const ownedN = rows.filter((r) => r.owned).length;
    const sections = order
      .map((rar) => ({ rar, items: rows.filter((r) => r.rarity === rar) }))
      .filter((g) => g.items.length)
      .map((g) => `
        <div class="pet-rarity-head" style="--rc:${g.items[0].rarityColor}">${label(g.rar)}
          <span class="pet-rarity-count">${g.items.filter((i) => i.owned).length}/${g.items.length}</span>
        </div>
        <div class="skin-grid">${g.items.map(card).join("")}</div>`)
      .join("");
    this.q("#tab-skins").innerHTML = `
      <div class="mkt-head"><span>✦ <b>${essence}</b> Essence</span><span class="pets-hint">Collected ${ownedN}/${rows.length} skins</span></div>
      ${sections}`;
    this.q("#tab-skins").querySelectorAll<HTMLButtonElement>(".skin-card").forEach((btn) => {
      btn.addEventListener("click", () => { const id = btn.dataset.id; if (id) onSelect(id); });
    });
  }

  /** Render the challenges tab (read-only progress list). */
  renderChallenges(essence: number, rows: ChallengeRow[]) {
    this.setEssenceBalance(essence);
    this.q("#tab-challenges").innerHTML = `<div class="chal-list">
        ${rows
          .map((r) => {
            const pct = Math.max(0, Math.min(1, r.progress / r.goal)) * 100;
            return `<div class="chal ${r.done ? "done" : ""}">
                <div class="chal-top"><span class="chal-name">${r.name}</span><span class="chal-reward">${r.done ? "✓ CLAIMED" : `✦ ${r.reward}`}</span></div>
                <div class="chal-desc">${r.desc}</div>
                <div class="chal-bar"><div class="chal-fill" style="width:${pct}%"></div></div>
                <div class="chal-prog">${Math.min(r.progress, r.goal)} / ${r.goal}</div>
              </div>`;
          })
          .join("")}
      </div>`;
  }

  /** Market tab: sell tradable loot for gold. */
  renderMarket(
    gold: number,
    items: { id: string; name: string; rarity: string; gold: number; color: string }[],
    onSell: (id: string) => void,
    onSellAll: () => void,
  ) {
    const total = items.reduce((s, i) => s + i.gold, 0);
    const list = items.length
      ? items
          .map(
            (it) => `<button class="mkt-item" data-id="${it.id}" style="--rc:${it.color}">
              <span class="mkt-dot"></span>
              <span class="mkt-name">${it.name}</span>
              <span class="mkt-rar">${it.rarity}</span>
              <span class="mkt-gold">⛀ ${it.gold}</span>
            </button>`,
          )
          .join("")
      : `<div class="mkt-empty">No loot yet — kill zombies & bosses to find tradable items.</div>`;
    this.q("#tab-market").innerHTML = `
      <div class="mkt-head">
        <span>Gold: <b>⛀ ${gold}</b></span>
        ${items.length ? `<button class="mkt-sellall" id="mkt-sellall">Sell all (⛀ ${total})</button>` : ""}
      </div>
      <div class="mkt-list">${list}</div>
      <div class="mkt-note">Gold will be tradable for $TINY at launch.</div>`;
    this.q("#tab-market").querySelectorAll<HTMLButtonElement>(".mkt-item").forEach((btn) => {
      btn.addEventListener("click", () => onSell(btn.dataset.id!));
    });
    const sa = this.root.querySelector("#mkt-sellall");
    if (sa) sa.addEventListener("click", () => onSellAll());
  }

  /** Pets tab: buy companion pets with gold. */
  renderPets(
    gold: number,
    rows: PetRow[],
    onAction: (id: string) => void,
    squad?: PetSquadInfo,
    onStar?: (id: string) => void,
    onToggleSquad?: (id: string) => void,
  ) {
    const order = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "celestial"];
    const label = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `${n}`);
    const card = (r: (typeof rows)[number]) => {
      const cls = r.affordable ? "" : "locked";
      const action = r.owned ? `Lv ${r.level} → ⛀ ${r.upCost}` : `🥚 Hatch from eggs`;
      const stageTag = r.owned && r.stage && r.stageName ? ` · ${r.stageName}` : "";
      const lvlBadge = r.owned ? `<span class="pet-lvl">Lv ${r.level}${stageTag}</span>` : "";
      // combat-XP bar toward the next level (pets level by fighting)
      const xpBar = r.owned && r.xpNext
        ? `<span class="pet-xp" title="Combat XP: ${Math.floor(r.xp ?? 0)}/${r.xpNext}"><span style="width:${Math.max(0, Math.min(100, ((r.xp ?? 0) / r.xpNext) * 100))}%"></span></span>`
        : "";
      const abilityTag = r.ability ? `<span class="pet-ability">✦ ${r.ability}</span>` : "";
      // ── PET DEPTH badges: role verb, shiny, star ascension, active marker ──
      const roleBadge = r.roleIcon ? `<span class="pet-role" title="${r.roleLabel ?? ""}" style="display:inline-block;font-size:10px;opacity:0.9;margin:2px 0;">${r.roleIcon} ${r.roleLabel ?? ""}</span>` : "";
      const shinyBadge = r.shiny ? `<span class="pet-shiny" title="Shiny variant" style="position:absolute;top:4px;left:4px;font-size:12px;">✨</span>` : "";
      const activeBadge = r.active ? `<span class="pet-active" title="In your active squad" style="position:absolute;top:4px;right:22px;color:#7be08a;font-size:10px;">●</span>` : "";
      const starBadge = this.petStarRow(r);
      let trialBlock = "";
      if (r.trial && r.trial.length) {
        const allDone = r.trial.every((t) => t.done);
        const goals = r.trial
          .map((t) => {
            const pct = Math.max(0, Math.min(100, (t.cur / t.goal) * 100));
            return `<div class="pet-goal ${t.done ? "done" : ""}">
              <span class="pet-goal-row"><span>${t.done ? "✓" : "◦"} ${t.label}</span><span>${fmt(t.cur)}/${fmt(t.goal)}</span></span>
              <span class="pet-goal-bar"><span style="width:${pct}%"></span></span>
            </div>`;
          })
          .join("");
        trialBlock = `<div class="pet-trial ${allDone ? "ready" : ""}">
          <span class="pet-trial-head">${allDone ? "✦ EVOLUTION READY" : "Evolution Trial"}</span>${goals}
        </div>`;
      }
      // Star-convert button (a dupe is available) — a separate clickable hook.
      const starBtn = r.canStar
        ? `<span class="pet-starbuy" data-star="${r.id}" title="Convert a dupe into a star" style="display:block;margin-top:3px;padding:2px 6px;border-radius:6px;font-size:10px;cursor:pointer;background:rgba(255,210,74,0.18);color:#ffd24a;text-align:center;">★+ ⛀ ${r.starCost ?? 0}</span>`
        : "";
      // Deploy/bench toggle for owned combat pets (the squad picker).
      const squadBtn = r.canSquad
        ? `<span class="pet-squadtoggle" data-squad="${r.id}" style="display:block;margin-top:3px;padding:2px 6px;border-radius:6px;font-size:10px;cursor:pointer;text-align:center;${r.benched ? "background:rgba(120,230,140,0.18);color:#7be08a;" : "background:rgba(255,255,255,0.1);color:#cfe;"}">${r.benched ? "＋ Deploy" : "− Bench"}</span>`
        : "";
      // Big "studio" hero shot of the actual voxel model on a tinted plinth so
      // the pet is the focus of the card; colour dot is the no-WebGL fallback.
      const stage = r.thumb
        ? `<div class="pet-stage"><img class="pet-preview" src="${r.thumb}" alt="" loading="lazy" /></div>`
        : `<div class="pet-stage"><span class="pet-dot"></span></div>`;
      return `<div class="pet-card-wrap" style="display:flex;flex-direction:column;">
        <button class="pet-card ${r.owned ? "owned" : ""} ${cls}" data-id="${r.id}" style="--pc:${r.color};--rc:${r.rarityColor}">
        ${stage}${lvlBadge}${activeBadge}${shinyBadge}
        <span class="pet-name">${r.name}</span>
        ${starBadge}
        ${roleBadge}
        <span class="pet-desc">${r.desc}</span>
        ${r.stats ? `<span class="pet-stats">${r.stats.map((s) => `<span class="pet-stat"><b>${s.value}</b><i>${s.label}</i></span>`).join("")}</span>` : ""}
        ${abilityTag}
        <span class="pet-cost">${action}</span>
        ${xpBar}
        ${trialBlock}
      </button>${squadBtn}${starBtn}</div>`;
    };
    // Group into rarity sections so a deep roster stays browsable.
    const ownedCount = rows.filter((r) => r.owned).length;
    const sections = order
      .map((rar) => ({ rar, items: rows.filter((r) => (r.rarity || "common") === rar) }))
      .filter((g) => g.items.length)
      .map(
        (g) => `
        <div class="pet-rarity-head" style="--rc:${g.items[0].rarityColor}">${label(g.rar)}
          <span class="pet-rarity-count">${g.items.filter((i) => i.owned).length}/${g.items.length}</span>
        </div>
        <div class="pets-grid">${g.items.map(card).join("")}</div>`,
      )
      .join("");
    this.q("#tab-pets").innerHTML = `
      <div class="mkt-head"><span>Gold: <b>⛀ ${gold}</b></span><span class="pets-hint">Collected ${ownedCount}/${rows.length} · level up with gold</span></div>
      ${this.petSquadPanel(squad)}
      ${sections}`;
    this.q("#tab-pets").querySelectorAll<HTMLButtonElement>(".pet-card").forEach((btn) => {
      btn.addEventListener("click", () => onAction(btn.dataset.id!));
    });
    if (onStar) {
      this.q("#tab-pets").querySelectorAll<HTMLElement>(".pet-starbuy").forEach((el) => {
        el.addEventListener("click", (e) => { e.stopPropagation(); onStar(el.dataset.star!); });
      });
    }
    if (onToggleSquad) {
      // kick from the squad panel + deploy/bench toggle on owned-pet cards
      this.q("#tab-pets").querySelectorAll<HTMLElement>(".squad-slot[data-kick]").forEach((el) => {
        el.addEventListener("click", (e) => { e.stopPropagation(); onToggleSquad(el.dataset.kick!); });
      });
      this.q("#tab-pets").querySelectorAll<HTMLElement>(".pet-squadtoggle").forEach((el) => {
        el.addEventListener("click", (e) => { e.stopPropagation(); onToggleSquad(el.dataset.squad!); });
      });
    }
  }

  /**
   * Show the level-up picker. Cards deal in with a stagger; picking pulses the
   * chosen card and dismisses the rest before `onPick` resumes the game.
   */
  showLevelUp(info: LevelUpInfo) {
    const overlay = this.q("#overlay-levelup");
    overlay.classList.remove("hidden");
    this.q("#lvl-num").textContent = info.level ? `Lv ${info.level}` : "";
    this.renderLevelCards(info);
    // replay the title/burst pop each time it opens (incl. rerolls)
    const burst = this.q("#lvl-burst");
    burst.classList.remove("go");
    void burst.offsetWidth; // reflow to restart the animation
    burst.classList.add("go");
  }

  /** (Re)render just the cards + reroll button — used on open and on reroll. */
  private renderLevelCards(info: LevelUpInfo) {
    const wrap = this.q("#levelup-cards");
    wrap.innerHTML = info.cards
      .map(
        (c, i) => `<button class="card ${c.tier}" data-id="${c.id}" style="--accent:${c.color}; --i:${i}">
          <span class="c-tier">${c.tier}</span>
          <span class="c-key">${i + 1}</span>
          <span class="c-icon">${c.icon}</span>
          <span class="c-name">${c.name}</span>
          <span class="c-desc">${c.desc}</span>
          <span class="c-stats">${c.deltas
            .map((d) => `<span class="c-stat"><b>${d.label}</b> ${d.from} <i>→</i> <em>${d.to}</em></span>`)
            .join("")}</span>
        </button>`,
      )
      .join("");

    const lock = () => wrap.classList.contains("locked");
    wrap.classList.remove("locked");
    wrap.querySelectorAll<HTMLButtonElement>(".card").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (lock()) return;
        const id = btn.dataset.id;
        if (!id) return;
        // selection juice: chosen card pops, the others fall away
        wrap.classList.add("locked");
        btn.classList.add("chosen");
        wrap.querySelectorAll(".card").forEach((o) => o !== btn && o.classList.add("gone"));
        info.onPick(id);
      });
    });

    const rr = this.q("#btn-reroll") as HTMLButtonElement;
    rr.classList.toggle("disabled", !info.canReroll);
    this.q("#rr-label").textContent = info.rerollCost > 0 ? `Reroll · ${info.rerollCost} pts` : "Reroll";
    rr.onclick = () => {
      if (!info.canReroll || lock()) return;
      info.onReroll();
    };
  }

  /** Pick a card by index (keyboard 1/2/3). Returns the chosen id or null. */
  pickLevelByIndex(i: number): boolean {
    const cards = this.q("#levelup-cards").querySelectorAll<HTMLButtonElement>(".card");
    const btn = cards[i];
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }
  triggerReroll() {
    const rr = this.q("#btn-reroll") as HTMLButtonElement;
    if (!rr.classList.contains("disabled")) rr.click();
  }
  hideLevelUp() {
    this.q("#overlay-levelup").classList.add("hidden");
    this.q("#levelup-cards").classList.remove("locked");
  }

  /** Boss health bar (0 = hide). */
  setBoss(name: string, frac: number) {
    const el = this.q("#hud-boss");
    el.classList.remove("hidden");
    this.q("#hud-boss-name").textContent = name;
    this.q("#hud-boss-fill").style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }
  hideBoss() {
    this.q("#hud-boss").classList.add("hidden");
  }
  onJoin(cb: (code: string) => void) {
    this.q("#btn-join").addEventListener("click", () => {
      cb((this.q("#join-code") as HTMLInputElement).value);
    });
  }
  setLobbyStatus(msg: string) {
    this.q("#lobby-status").textContent = msg;
  }
  onServer(cb: () => void) {
    this.q("#btn-server").addEventListener("click", cb);
  }
  onWallet(cb: () => void) {
    this.q("#btn-wallet").addEventListener("click", cb);
    this.q("#btn-connect").addEventListener("click", cb); // hero CTA shares the connect flow
    this.q("#wallet-pill").addEventListener("click", cb); // tap the pill to disconnect
  }
  /** Wire the Claim button + the token-backend config gear. */
  onClaim(onClaim: () => void, onConfig: () => void) {
    this.q("#btn-claim").addEventListener("click", onClaim);
    this.q("#btn-token-api").addEventListener("click", onConfig);
  }
  setClaimStatus(text: string) {
    this.q("#claim-status").textContent = text;
  }
  /** Show transient state on the splash hero connect button (e.g. "Connecting…").
   *  The splash hides the status line + address row, so this button IS the feedback. */
  setConnectLabel(text: string) {
    this.q("#btn-connect").textContent = text;
  }
  /** Reflect wallet connection state on the menu button + balance chip. */
  setWallet(connected: boolean, short: string, balanceLabel: string) {
    this.q("#btn-wallet").textContent = connected ? short : "Connect Wallet";
    this.q("#btn-wallet").classList.toggle("connected", connected);
    // Hero CTA stays visible as the splash's connection indicator: shows the
    // linked address when connected (the address row is hidden on the splash).
    const connectBtn = this.q("#btn-connect");
    connectBtn.textContent = connected ? `✅ ${short}` : "🔗 Connect Wallet";
    connectBtn.classList.toggle("connected", connected);
    // persistent top-of-screen pill (visible across every screen, not just the menu)
    this.q("#wallet-pill").classList.toggle("hidden", !connected);
    this.q("#wallet-pill-addr").textContent = short;
    this.q("#wallet-bal").textContent = connected ? balanceLabel : "";
    // the claim row only makes sense once a wallet is linked
    this.q("#claim-row").classList.toggle("hidden", !connected);
  }
  showRoomCode(code: string) {
    this.q("#hud-room-code").textContent = code;
    this.q("#hud-room").classList.remove("hidden");
  }
  hideRoomCode() {
    this.q("#hud-room").classList.add("hidden");
  }

  setRound(n: number) {
    this.roundEl.textContent = String(n);
  }
  private _cOverdrive = false;
  /** Toggle the "2× OVERDRIVE" banner (Chronos time-warp confirmation). */
  setOverdrive(on: boolean) {
    if (on === this._cOverdrive) return;
    this._cOverdrive = on;
    this.q("#overdrive").classList.toggle("hidden", !on);
  }
  private _cRampMul = -1;
  /** Player-kill rampage meter: a glowing "×N <TIER>" chip + fill bar. Hidden at ×1. */
  setRampage(mul: number, frac: number, tier: string) {
    const el = this.q("#rampage");
    const show = mul > 1.05;
    el.classList.toggle("hidden", !show);
    if (!show) { this._cRampMul = -1; return; }
    const m = Math.round(mul * 10) / 10;
    if (m !== this._cRampMul) {
      this._cRampMul = m;
      this.q("#rampage-x").textContent = `×${m.toFixed(1)}${tier ? "  " + tier : ""}`;
    }
    (this.q("#rampage-fill") as HTMLElement).style.width = `${Math.min(100, frac * 100)}%`;
  }
  setPoints(p: number) {
    if (p === this._cPoints) return;
    this._cPoints = p;
    this.pointsEl.textContent = String(p);
  }
  setHealth(hp: number, max: number) {
    const pct = Math.max(0, Math.min(1, hp / max));
    if (Math.abs(pct - this._cHpPct) < 0.005) return; // skip sub-pixel changes
    this._cHpPct = pct;
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthFill.classList.toggle("low", pct < 0.35);
  }
  /** Show the kill-combo multiplier (0 = hide). `frac` drains the bar. */
  setCombo(mult: number, frac: number) {
    if (mult <= 1) {
      if (this._cComboMult !== 0) {
        this._cComboMult = 0;
        this.q("#hud-combo").classList.remove("show");
      }
      return;
    }
    if (mult !== this._cComboMult) {
      this._cComboMult = mult;
      this.q("#hud-combo").classList.add("show");
      this.q("#hud-combo-x").textContent = `x${mult % 1 === 0 ? mult : mult.toFixed(2).replace(/0$/, "")}`;
    }
    const fr = Math.round(frac * 50); // ~2% steps — avoid a DOM write every frame
    if (fr !== this._cComboFrac) {
      this._cComboFrac = fr;
      this.q("#hud-combo-fill").style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    }
  }
  setPowerups(list: ActiveGum[]) {
    // signature = ids + whole seconds remaining; only rebuild when it changes
    let sig = "";
    for (const a of list) sig += a.def.short + Math.ceil(a.remaining) + ",";
    if (sig === this._cPowerSig) return;
    this._cPowerSig = sig;
    this.powerupsEl.innerHTML = list
      .map((a) => {
        const c = `#${a.def.color.toString(16).padStart(6, "0")}`;
        return `<span class="gum" style="--gc:${c}">${a.def.short} <b>${Math.ceil(a.remaining)}s</b></span>`;
      })
      .join("");
  }
  setWeapon(name: string, ammo: number, reserve: string, reloading: boolean) {
    if (name === this._cWeapon && ammo === this._cAmmo && reserve === this._cReserve && reloading === this._cReloading) return;
    if (name !== this._cWeapon) {
      this._cWeapon = name;
      this.weaponName.textContent = name;
    }
    if (ammo !== this._cAmmo) {
      this._cAmmo = ammo;
      this.weaponAmmo.textContent = String(ammo);
    }
    if (reserve !== this._cReserve) {
      this._cReserve = reserve;
      this.q("#hud-reserve").textContent = reserve;
    }
    if (reloading !== this._cReloading) {
      this._cReloading = reloading;
      this.q("#hud-reloading").textContent = reloading ? "RELOADING…" : "";
    }
  }

  showPrompt(text: string, affordable: boolean) {
    this.promptEl.textContent = text;
    this.promptEl.classList.add("show");
    this.promptEl.classList.toggle("cant", !affordable);
  }
  hidePrompt() {
    this.promptEl.classList.remove("show");
  }

  private eggPanelEl?: HTMLElement;
  /** Drop-rate panel shown when the player stands by a gacha egg. `odds` is the
   *  per-rarity percentage list; `rarityColor` tints each row. Pass affordable
   *  to dim the cost when the player can't pay. */
  showEggPanel(
    name: string,
    cost: number,
    affordable: boolean,
    odds: { label: string; pct: number; color: string }[],
  ) {
    if (!this.eggPanelEl) {
      this.eggPanelEl = document.createElement("div");
      this.eggPanelEl.id = "egg-panel";
      this.root.appendChild(this.eggPanelEl);
    }
    const rows = odds
      .map(
        (o) =>
          `<div class="egg-odd"><span style="color:${o.color}">${o.label}</span><span class="pct">${o.pct}%</span></div>`,
      )
      .join("");
    this.eggPanelEl.innerHTML =
      `<div class="egg-name">🥚 ${name}</div>` +
      `<div class="egg-cost" style="color:${affordable ? "var(--gold)" : "var(--danger)"}">${cost.toLocaleString()} gold</div>` +
      `<div class="egg-odds">${rows}</div>`;
    this.eggPanelEl.classList.add("show");
  }
  hideEggPanel() {
    this.eggPanelEl?.classList.remove("show");
  }

  private eggRevealEl?: HTMLElement;
  private eggRevealTimer = 0;
  /** Cinematic hatch reveal: the egg shakes, cracks with a flash, then the pet
   *  thumbnail bursts in with its rarity glow + status. Dismisses on click or
   *  after a few seconds; `onDone` fires once when it closes. */
  showEggReveal(opts: {
    eggColor: string;
    petName: string;
    petThumb: string;
    rarityLabel: string;
    rarityColor: string;
    status: "new" | "dupe" | "shiny";
    statusText: string;
    confetti?: boolean;
    onDone?: () => void;
  }) {
    if (!this.eggRevealEl) {
      this.eggRevealEl = document.createElement("div");
      this.eggRevealEl.id = "egg-reveal";
      this.root.appendChild(this.eggRevealEl);
    }
    const el = this.eggRevealEl;
    el.style.setProperty("--egg-color", opts.eggColor);
    el.style.setProperty("--rarity-color", opts.rarityColor);
    // high-grade confetti pieces, fired a beat after the reveal pops
    let confetti = "";
    if (opts.confetti) {
      const cols = ["#ff5a7a", "#ffd24a", "#6ad7ff", "#7be08a", "#c792ea", "#ff9ec7", "#ffffff"];
      for (let i = 0; i < 40; i++) {
        const col = cols[i % cols.length];
        const drift = (Math.random() - 0.5) * 460;
        const dur = 1.0 + Math.random() * 0.9;
        const delay = 1.55 + Math.random() * 0.5;
        confetti += `<i class="er-confetti" style="background:${col};--drift:${drift}px;animation-duration:${dur}s;animation-delay:${delay}s;"></i>`;
      }
    }
    // Rebuild the stage (re-triggers the CSS animations each hatch).
    el.innerHTML = `
      <div class="er-stage">
        <div class="er-egg"></div>
        <div class="er-flash"></div>
        <div class="er-pet">
          <div class="er-thumb-wrap">
            <div class="er-ring"></div>
            <img class="er-thumb" src="${opts.petThumb}" alt="">
          </div>
          <div class="er-rarity" style="color:${opts.rarityColor}">${opts.rarityLabel}</div>
          <div class="er-name">${opts.petName}</div>
          <div class="er-status ${opts.status}">${opts.statusText}</div>
        </div>
        ${confetti}
        <div class="er-hint">tap to continue</div>
      </div>`;
    el.classList.add("show");
    const close = () => {
      if (!el.classList.contains("show")) return;
      el.classList.remove("show");
      el.onclick = null;
      if (this.eggRevealTimer) clearTimeout(this.eggRevealTimer);
      opts.onDone?.();
    };
    // ignore clicks until the reveal has actually popped (so you can't skip blind)
    el.onclick = () => { if (performance.now() - start > 1700) close(); };
    const start = performance.now();
    if (this.eggRevealTimer) clearTimeout(this.eggRevealTimer);
    this.eggRevealTimer = window.setTimeout(close, 4200);
  }
  /** True while a hatch reveal is on screen (main blocks re-hatching). */
  get eggRevealOpen(): boolean {
    return !!this.eggRevealEl?.classList.contains("show");
  }

  private petIndexEl?: HTMLElement;
  /** Pet collection index overlay: a grid of every pet (owned lit, missing
   *  dimmed) with shiny/star markers + a completion header. Dismiss on click. */
  showPetIndex(entries: { name: string; thumb: string; owned: boolean; rarityColor: string; shiny: boolean; stars: number }[]) {
    if (!this.petIndexEl) {
      this.petIndexEl = document.createElement("div");
      this.petIndexEl.id = "pet-index";
      this.petIndexEl.addEventListener("click", (e) => { if (e.target === this.petIndexEl || (e.target as HTMLElement).classList.contains("pi-close")) this.petIndexEl!.classList.remove("show"); });
      this.root.appendChild(this.petIndexEl);
    }
    const ownedN = entries.filter((e) => e.owned).length;
    const pct = entries.length ? Math.round((ownedN / entries.length) * 100) : 0;
    const cells = entries.map((e) => {
      const stars = e.stars > 0 ? `<span class="pi-stars">${"★".repeat(Math.min(5, e.stars))}</span>` : "";
      const shiny = e.shiny ? `<span class="pi-shiny">✨</span>` : "";
      return `<div class="pi-cell ${e.owned ? "owned" : "missing"}" style="border-color:${e.owned ? e.rarityColor : "#3a3a3a"}">
        <img src="${e.thumb}" alt="">${stars}${shiny}
        <span class="pi-name">${e.owned ? e.name : "???"}</span>
      </div>`;
    }).join("");
    this.petIndexEl.innerHTML = `
      <div class="pi-panel">
        <div class="pi-head">🐾 Pet Collection — <b>${ownedN}/${entries.length}</b> (${pct}%)<button class="pi-close">✕</button></div>
        <div class="pi-grid">${cells}</div>
      </div>`;
    this.petIndexEl.classList.add("show");
  }

  private wheelEl?: HTMLElement;
  private wheelTimer = 0;
  /** Fortune wheel: an animated spin that lands on `win`, then fires onDone. */
  showWheel(labels: string[], win: number, onDone: () => void) {
    if (!this.wheelEl) {
      this.wheelEl = document.createElement("div");
      this.wheelEl.id = "wheel-modal";
      this.root.appendChild(this.wheelEl);
    }
    const n = labels.length;
    const seg = 360 / n;
    // cohesive jewel palette; a thin dark divider is baked between each slice
    const cols = ["#ff6b8a", "#ffcf52", "#5ec8e0", "#7be08a", "#b88ae0", "#ff9ec7", "#ffa94a", "#74c0fc"];
    const div = "rgba(60,40,24,0.55)";
    const stops = labels.map((_, i) => {
      const a0 = i * seg, a1 = (i + 1) * seg;
      return `${div} ${a0}deg ${a0 + 0.8}deg, ${cols[i % cols.length]} ${a0 + 0.8}deg ${a1}deg`;
    }).join(", ");
    // land the winning segment under the top pointer (with several extra turns)
    const target = 360 * 5 - (win * seg + seg / 2);
    // labels are children of the spinning wheel, so counter-rotate them by the
    // wheel's resting angle (-target) → they read screen-upright when it stops.
    const labelEls = labels.map((l, i) => {
      const ang = i * seg + seg / 2;
      return `<span class="wh-label" style="transform:rotate(${ang}deg) translateY(-102px) rotate(${-ang - target}deg)">${l}</span>`;
    }).join("");
    const pegs = Array.from({ length: 12 }, (_, i) =>
      `<span class="wh-peg" style="transform:rotate(${i * 30}deg) translateY(-164px)"></span>`).join("");
    this.wheelEl.innerHTML = `
      <div class="wh-stage">
        <div class="wh-title">🎡 Fortune Wheel</div>
        <div class="wh-wrap">
          <div class="wh-pointer"></div>
          <div class="wh-rim">${pegs}</div>
          <div class="wh-wheel" style="background:conic-gradient(${stops})">${labelEls}</div>
          <div class="wh-hub">✦</div>
        </div>
        <div class="wh-hint">good luck!</div>
      </div>`;
    this.wheelEl.classList.add("show");
    const wheel = this.wheelEl.querySelector(".wh-wheel") as HTMLElement;
    // reset then animate to target
    wheel.style.transition = "none";
    wheel.style.transform = "rotate(0deg)";
    void wheel.offsetWidth; // reflow so the transition re-arms
    wheel.style.transition = "transform 3.6s cubic-bezier(0.15, 0.9, 0.2, 1)";
    wheel.style.transform = `rotate(${target}deg)`;
    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.wheelEl?.classList.remove("show");
      onDone();
    }, 4000);
  }

  private popEl?: HTMLElement;
  /** "N players here" social chip on the island; pass <= 0 to hide it. */
  setIslandPopulation(n: number) {
    if (!this.popEl) {
      this.popEl = document.createElement("div");
      this.popEl.className = "island-pop";
      this.root.appendChild(this.popEl);
    }
    if (n <= 0) {
      this.popEl.style.display = "none";
      return;
    }
    this.popEl.style.display = "block";
    this.popEl.textContent = `🟢 ${n} ${n === 1 ? "player" : "players"} here`;
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 1400);
  }

  showStart() {
    // splash/boot/game-over: a clean screen offering ONLY "Enter Island"
    this.startOverlay.classList.remove("hidden", "shop-modal", "solo-tab");
    this.startOverlay.classList.add("splash");
  }
  hideStart() {
    this.startOverlay.classList.add("hidden");
  }

  /** Hide the in-combat HUD (round/points/health/weapon/…) without the island
   *  lobby chrome — used by Bed Wars, which draws its own resource HUD. */
  hideCombatHud(on: boolean) {
    this.root.classList.toggle("island-mode", on);
    // Bed Wars is NOT the island lobby: also pull down the island bottom bar
    // (the "walk up to a glowing pad / Leave Island" chrome) when hiding.
    if (on) this.q("#island-bar").classList.add("hidden");
  }

  /** Is a dismissable menu overlay currently up (shop modal or pet index)? */
  isMenuOpen(): boolean {
    const shop = !this.startOverlay.classList.contains("hidden") && this.startOverlay.classList.contains("shop-modal");
    const index = !!this.petIndexEl?.classList.contains("show");
    return shop || index;
  }

  /** Close the topmost open menu (pet index, then shop modal). Returns true if
   *  one was closed. Egg-hatch / wheel modals manage their own lifecycle. */
  closeTopMenu(): boolean {
    if (this.petIndexEl?.classList.contains("show")) { this.petIndexEl.classList.remove("show"); return true; }
    if (!this.startOverlay.classList.contains("hidden") && this.startOverlay.classList.contains("shop-modal")) { this.hideStart(); return true; }
    return false;
  }

  showGameOver(
    round: number,
    points: number,
    essenceEarned: number,
    newBest: boolean,
    board: { round: number; score: number; date: number }[] = [],
    rank = -1,
  ) {
    // Personal leaderboard: top runs, with THIS run highlighted at its slot.
    let lb = "";
    if (board.length) {
      const rows = board
        .map((e, i) => {
          const me = i === rank ? " lb-me" : "";
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `<div class="lb-row${me}"><span class="lb-rank">${medal}</span>` +
            `<span class="lb-rd">Round ${e.round}</span>` +
            `<span class="lb-sc">${e.score.toLocaleString()}</span></div>`;
        })
        .join("");
      lb = `<div class="lb-title">Best Runs</div><div class="lb">${rows}</div>`;
    }
    this.overStats.innerHTML = `
      ${newBest ? '<div class="newbest-ribbon">★ NEW PERSONAL BEST ★</div>' : ""}
      <div class="over-grid">
        <div class="over-stat"><span class="os-ico">🌊</span><span class="os-val">${round}</span><span class="os-lbl">Round reached</span></div>
        <div class="over-stat"><span class="os-ico">⭐</span><span class="os-val">${points.toLocaleString()}</span><span class="os-lbl">Points banked</span></div>
        <div class="over-stat earn"><span class="os-ico">✦</span><span class="os-val">+${essenceEarned}</span><span class="os-lbl">Essence earned</span></div>
      </div>
      ${lb}`;
    this.overOverlay.classList.remove("hidden");
  }
  hideGameOver() {
    this.overOverlay.classList.add("hidden");
  }

  /**
   * Co-op spectator overlay shown to a GUEST whose player has died while the
   * run continues on the host (the host-only gameOver never fires for them, so
   * without this they're stuck in "playing" with no UI and no way out).
   *
   * Idempotent — safe to call every frame while down; only (re)wires the exit
   * button on first show. `onExit` should tear down the net session and return
   * to the menu. Pair with hideGuestDown() when the guest revives or leaves.
   */
  showGuestDown(onExit: () => void) {
    let ov = document.getElementById("guest-down");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "guest-down";
      ov.style.cssText =
        "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;" +
        "justify-content:center;gap:18px;background:rgba(8,10,16,0.62);z-index:50;" +
        "font-family:inherit;color:#f4f4f4;text-align:center;pointer-events:auto;";
      ov.innerHTML =
        `<div style="font-size:34px;font-weight:800;letter-spacing:1px;">You're down</div>` +
        `<div style="opacity:0.85;">Spectating your team — hang tight or bail out.</div>` +
        `<button id="btn-guest-exit" style="margin-top:6px;padding:12px 26px;font:inherit;` +
        `font-weight:700;cursor:pointer;border:none;border-radius:10px;` +
        `background:#e06a4a;color:#fff;">Exit to menu</button>`;
      this.root.appendChild(ov);
      (ov.querySelector("#btn-guest-exit") as HTMLButtonElement).addEventListener("click", () => {
        this.hideGuestDown();
        onExit();
      });
    }
    ov.style.display = "flex";
  }
  hideGuestDown() {
    const ov = document.getElementById("guest-down");
    if (ov) ov.style.display = "none";
  }

  // ─────────────────── IDLE / PRESTIGE / STREAK OVERLAYS ───────────────────
  // Full-screen overlay divs created lazily and appended near the menu/over
  // overlays (same root, same .overlay sibling region as #overlay-start /
  // #overlay-over). Each mirrors showGuestDown's idempotent inline-styled
  // pattern so they need no CSS changes and can't collide with the other agents.

  /** Format a duration (ms) as a friendly "Xh Ym" / "Ym" / "Zs" string. */
  private fmtDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  private overlayShell(id: string): HTMLElement {
    let ov = document.getElementById(id);
    if (!ov) {
      ov = document.createElement("div");
      ov.id = id;
      ov.style.cssText =
        "position:fixed;inset:0;display:none;flex-direction:column;align-items:center;" +
        "justify-content:center;gap:16px;background:rgba(8,10,16,0.74);z-index:60;" +
        "font-family:inherit;color:#f4f4f4;text-align:center;pointer-events:auto;padding:24px;";
      this.root.appendChild(ov);
    }
    return ov;
  }

  /** "While You Were Away": offline gold/essence accrued, capped, since lastSeen. */
  showWelcomeBack(info: { gold: number; essence: number; durationMs: number }) {
    const ov = this.overlayShell("overlay-welcomeback");
    ov.innerHTML =
      `<div style="font-size:30px;font-weight:800;letter-spacing:1px;">Welcome back</div>` +
      `<div style="opacity:0.85;max-width:380px;">You were away ${this.fmtDuration(info.durationMs)}. Your bankers kept working — at half pace.</div>` +
      `<div style="font-size:22px;font-weight:700;margin-top:4px;">+${info.gold} 🪙` +
      (info.essence > 0 ? `  ·  +${info.essence} ✦` : "") +
      `</div>` +
      `<button id="btn-welcomeback-ok" style="margin-top:10px;padding:12px 30px;font:inherit;` +
      `font-weight:700;cursor:pointer;border:none;border-radius:10px;background:#5aa9e0;color:#fff;">Collect</button>`;
    (ov.querySelector("#btn-welcomeback-ok") as HTMLButtonElement).onclick = () => {
      ov.style.display = "none";
    };
    ov.style.display = "flex";
  }

  /** Wire the menu prestige chip to open the ascension overlay. */
  onPrestige(cb: () => void) {
    this.q("#prestige-chip").addEventListener("click", cb);
  }

  /** Reflect prestige standing on the menu chip (banked points, multiplier, and
   *  whether any are claimable — chip glows when so). */
  setPrestige(prestige: number, multiplier: number, available: number) {
    this.q("#prestige-bal").textContent = String(prestige);
    this.q("#prestige-mul").textContent = `(x${multiplier.toFixed(2)})`;
    const chip = this.q("#prestige-chip");
    chip.style.opacity = available > 0 ? "1" : "0.85";
    chip.style.textShadow = available > 0 ? "0 0 10px rgba(255,210,74,0.9)" : "none";
    chip.title = available > 0 ? `Ascend now for +${available} prestige` : "Ascension multiplier";
  }

  /** Ascension confirmation overlay. `onConfirm` performs the prestige (resets
   *  the gold economy, banks the points). Disabled when nothing's claimable. */
  showPrestige(
    info: { current: number; gain: number; lifetimeGold: number; nextMultiplier: number },
    onConfirm: () => void,
  ) {
    const ov = this.overlayShell("overlay-prestige");
    const can = info.gain > 0;
    ov.innerHTML =
      `<div style="font-size:30px;font-weight:800;letter-spacing:1px;">Ascend</div>` +
      `<div style="opacity:0.85;max-width:420px;">Bank your lifetime gold into permanent <b>Prestige</b> for a bigger gold &amp; essence multiplier. This <b>resets your gold, gold income upgrades</b> — your pets, skins, essence, bests and streak stay.</div>` +
      `<div style="font-size:16px;opacity:0.9;">Lifetime gold: ${Math.floor(info.lifetimeGold).toLocaleString()}</div>` +
      `<div style="font-size:22px;font-weight:700;margin-top:2px;">` +
      (can ? `+${info.gain} prestige  ·  x${info.nextMultiplier.toFixed(2)} next` : `Keep earning gold to unlock your next prestige`) +
      `</div>` +
      `<div style="display:flex;gap:12px;margin-top:8px;">` +
      `<button id="btn-prestige-go" ${can ? "" : "disabled"} style="padding:12px 28px;font:inherit;font-weight:700;` +
      `cursor:${can ? "pointer" : "not-allowed"};border:none;border-radius:10px;` +
      `background:${can ? "#ffd24a" : "#555"};color:${can ? "#2a2208" : "#aaa"};">Ascend</button>` +
      `<button id="btn-prestige-cancel" style="padding:12px 28px;font:inherit;font-weight:700;cursor:pointer;` +
      `border:none;border-radius:10px;background:#3a3f4a;color:#f4f4f4;">Cancel</button>` +
      `</div>`;
    const close = () => {
      ov.style.display = "none";
    };
    if (can) {
      (ov.querySelector("#btn-prestige-go") as HTMLButtonElement).onclick = () => {
        close();
        onConfirm();
      };
    }
    (ov.querySelector("#btn-prestige-cancel") as HTMLButtonElement).onclick = close;
    ov.style.display = "flex";
  }

  // ── PAUSE / SETTINGS overlay ───────────────────────────────────────────────
  // A full-screen pause menu shown whenever the game state is "paused". Works on
  // desktop (P/Escape) AND mobile (the touch Pause button). The overlay sits at
  // z-index 60 (above the touch joystick layer at 30) with pointer-events:auto so
  // its buttons/slider are tappable. Built once, then re-shown; the live controls
  // are wired on each show() so the callbacks always target the current run.
  private pauseEl?: HTMLElement;
  private pauseMuteBtn?: HTMLButtonElement;
  /**
   * Show the pause/settings overlay. `muted` seeds the mute toggle; `volume`
   * (0..1) seeds the music slider. Callbacks fire live as the player interacts:
   *   onResume       — dismiss + unpause
   *   onQuit         — leave the run cleanly back to the island hub
   *   onToggleMute   — flip the master mute (returns the NEW muted state for the label)
   *   onVolume(v)    — set music volume (0..1)
   */
  showPause(opts: {
    muted: boolean;
    volume: number;
    onResume: () => void;
    onQuit: () => void;
    onToggleMute: () => boolean;
    onVolume: (v: number) => void;
  }) {
    const ov = this.overlayShell("overlay-pause");
    // user-select:none on the shell avoids the iOS Copy bubble on long-press.
    ov.style.userSelect = "none";
    (ov.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    ov.innerHTML =
      `<div class="pause-card">` +
        `<div class="pause-title">PAUSED</div>` +
        `<button class="pause-btn pause-resume" id="btn-pause-resume">▶ Resume</button>` +
        `<div class="pause-settings">` +
          `<button class="pause-toggle" id="btn-pause-mute">${opts.muted ? "🔇 Sound: Off" : "🔊 Sound: On"}</button>` +
          `<label class="pause-vol">` +
            `<span>🎵 Music</span>` +
            `<input type="range" id="pause-vol-slider" min="0" max="100" value="${Math.round(opts.volume * 100)}" />` +
          `</label>` +
        `</div>` +
        `<button class="pause-btn pause-quit" id="btn-pause-quit">✕ Quit to Island</button>` +
      `</div>`;
    this.pauseEl = ov;
    this.pauseMuteBtn = ov.querySelector("#btn-pause-mute") as HTMLButtonElement;
    (ov.querySelector("#btn-pause-resume") as HTMLButtonElement).onclick = () => opts.onResume();
    (ov.querySelector("#btn-pause-quit") as HTMLButtonElement).onclick = () => opts.onQuit();
    this.pauseMuteBtn.onclick = () => {
      const nowMuted = opts.onToggleMute();
      if (this.pauseMuteBtn) this.pauseMuteBtn.textContent = nowMuted ? "🔇 Sound: Off" : "🔊 Sound: On";
    };
    const slider = ov.querySelector("#pause-vol-slider") as HTMLInputElement;
    slider.oninput = () => opts.onVolume(Math.max(0, Math.min(1, Number(slider.value) / 100)));
    ov.style.display = "flex";
  }
  hidePause() {
    if (this.pauseEl) this.pauseEl.style.display = "none";
  }
  /** True while the pause overlay is on screen (lets the loop avoid re-binding it). */
  get pauseOpen(): boolean {
    return this.pauseEl?.style.display === "flex";
  }

  // ── TD MODE-SELECT panel (item 3) ──────────────────────────────────────────
  // A tap/click menu shown at the Tower Defense gateway so mobile players can
  // pick a variant (number keys still work on desktop as shortcuts). Lives in a
  // pointer-events:none container (so the joystick works in empty space) with
  // pointer-events:auto buttons. Rebuilt only when its signature changes.
  private tdModeEl?: HTMLElement;
  private tdModeSig = "";
  showTdModeSelect(
    info: { bestWave: number; dailyDone: boolean; wagerStake: number; canWager: boolean },
    onPick: (kind: "solo" | "duel" | "endless" | "daily" | "wager") => void,
  ) {
    if (!this.tdModeEl) {
      this.tdModeEl = document.createElement("div");
      this.tdModeEl.id = "td-modeselect";
      this.root.appendChild(this.tdModeEl);
    }
    const el = this.tdModeEl;
    const sig = `${info.bestWave}|${info.dailyDone}|${info.wagerStake}|${info.canWager}`;
    if (sig !== this.tdModeSig) {
      this.tdModeSig = sig;
      const btn = (kind: string, key: string, name: string, sub: string, cls = "") =>
        `<button class="tdm-btn ${cls}" data-kind="${kind}" type="button">` +
        `<span class="tdm-key">${key}</span><span class="tdm-name">${name}</span>` +
        `<span class="tdm-sub">${sub}</span></button>`;
      el.innerHTML =
        `<div class="tdm-title">🗼 Tower Defense — pick a mode</div>` +
        `<div class="tdm-row">` +
          btn("solo", "1", "Solo", "18 waves") +
          btn("duel", "2", "Duel", "vs the House") +
          btn("endless", "3", "Endless", `best ${info.bestWave}`) +
          btn("daily", "4", "Daily", info.dailyDone ? "✓ done" : "1/day", info.dailyDone ? "tdm-done" : "") +
          btn("wager", "5", "Wager", `${info.wagerStake}🪙 gold`, "tdm-wager") +
        `</div>`;
      el.querySelectorAll<HTMLButtonElement>(".tdm-btn").forEach((b) => {
        b.addEventListener("click", () => onPick(b.dataset.kind as "solo" | "duel" | "endless" | "daily" | "wager"));
      });
    }
    el.classList.add("show");
  }
  hideTdModeSelect() {
    this.tdModeEl?.classList.remove("show");
  }
  get tdModeSelectOpen(): boolean {
    return !!this.tdModeEl?.classList.contains("show");
  }

  // ── WAGER CONFIRM (item 4) ──────────────────────────────────────────────────
  /** Honest, explicit confirm before staking GOLD on a duel "vs the House".
   *  Spells out stake, win payout, the 90/10 treasury split, and the mid-match
   *  forfeit rule. Only `onConfirm` deducts + starts. Reuses the prestige-confirm
   *  overlay pattern (z-index 60, pointer-events:auto — tappable on mobile). */
  showWagerConfirm(
    info: { stake: number; payout: number; fee: number; canAfford: boolean },
    onConfirm: () => void,
  ) {
    const ov = this.overlayShell("overlay-wager");
    ov.style.userSelect = "none";
    (ov.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    const can = info.canAfford;
    ov.innerHTML =
      `<div style="font-size:30px;font-weight:800;letter-spacing:1px;">💰 Gold Wager</div>` +
      `<div style="opacity:0.85;max-width:420px;">A 1v1 Tower-Defense duel <b>vs the House</b> (an AI rival). This stakes <b>GOLD</b>, not SOL — on-chain SOL wagers are coming later.</div>` +
      `<div style="font-size:16px;opacity:0.95;line-height:1.7;margin-top:2px;">` +
        `Your stake: <b style="color:#ffd24a;">${info.stake.toLocaleString()} 🪙</b><br>` +
        `Win the duel: <b style="color:#7be08a;">+${info.payout.toLocaleString()} 🪙</b><br>` +
        `<span style="opacity:0.8;">The House keeps a 10% rake (${info.fee.toLocaleString()} 🪙 of the pot).</span>` +
      `</div>` +
      `<div style="font-size:14px;color:#ff9c8c;max-width:420px;font-weight:700;">⚠ Leaving mid-match FORFEITS your stake.</div>` +
      (can ? "" : `<div style="font-size:14px;color:#ff8a7a;">Not enough gold to sit at this table.</div>`) +
      `<div style="display:flex;gap:12px;margin-top:8px;">` +
        `<button id="btn-wager-go" ${can ? "" : "disabled"} style="padding:12px 28px;font:inherit;font-weight:700;` +
        `cursor:${can ? "pointer" : "not-allowed"};border:none;border-radius:10px;` +
        `background:${can ? "#ffd24a" : "#555"};color:${can ? "#2a2208" : "#aaa"};">Stake ${info.stake} 🪙</button>` +
        `<button id="btn-wager-cancel" style="padding:12px 28px;font:inherit;font-weight:700;cursor:pointer;` +
        `border:none;border-radius:10px;background:#3a3f4a;color:#f4f4f4;">Cancel</button>` +
      `</div>`;
    const close = () => { ov.style.display = "none"; };
    if (can) {
      (ov.querySelector("#btn-wager-go") as HTMLButtonElement).onclick = () => { close(); onConfirm(); };
    }
    (ov.querySelector("#btn-wager-cancel") as HTMLButtonElement).onclick = close;
    ov.style.display = "flex";
  }
  get wagerConfirmOpen(): boolean {
    return document.getElementById("overlay-wager")?.style.display === "flex";
  }

  /** Login-streak chip: 🔥 N-day count + a tiny ❄ marker per banked freeze. */
  setStreak(count: number, freezes: number) {
    this.q("#streak-count").textContent = String(count);
    const chip = this.q("#streak-chip");
    chip.title = freezes > 0 ? `${count}-day streak · ${freezes} freeze${freezes > 1 ? "s" : ""} banked` : `${count}-day streak`;
    chip.style.opacity = count > 0 ? "1" : "0.7";
    // append freeze markers to the chip label (rebuild the suffix each call)
    const existing = chip.querySelector(".streak-freezes");
    if (existing) existing.remove();
    if (freezes > 0) {
      const span = document.createElement("span");
      span.className = "streak-freezes";
      span.style.marginLeft = "4px";
      span.textContent = "❄".repeat(Math.min(freezes, 3));
      chip.appendChild(span);
    }
  }

  /** Daily-quest board on the menu: a row per quest with a progress bar and its
   *  soft gold/essence reward; finished rows are ticked. */
  showDailies(
    rows: { id: string; name: string; progress: number; goal: number; gold: number; essence: number; done: boolean; claimed: boolean }[],
  ) {
    const board = this.q("#daily-board");
    const items = rows
      .map((r) => {
        const pct = Math.max(0, Math.min(1, r.goal > 0 ? r.progress / r.goal : 0)) * 100;
        const tick = r.done ? "✓ " : "";
        const status = r.claimed ? "claimed" : r.done ? "ready" : `${r.progress}/${r.goal}`;
        return (
          `<div class="daily-row" style="display:flex;align-items:center;gap:10px;padding:6px 2px;opacity:${r.claimed ? 0.55 : 1};">` +
          `<div style="flex:1;min-width:0;">` +
          `<div style="font-weight:700;font-size:13px;">${tick}${r.name}</div>` +
          `<div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;margin-top:3px;">` +
          `<div style="height:100%;width:${pct}%;background:${r.done ? "#8fcf6f" : "#5aa9e0"};"></div></div>` +
          `</div>` +
          `<div style="font-size:12px;opacity:0.85;text-align:right;white-space:nowrap;">${status}<br>+${r.gold}🪙 +${r.essence}✦</div>` +
          `</div>`
        );
      })
      .join("");
    board.innerHTML =
      `<div style="margin-top:14px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.05);">` +
      `<div style="font-weight:800;letter-spacing:0.5px;opacity:0.9;margin-bottom:4px;">DAILY QUESTS</div>` +
      items +
      `</div>`;
  }

  // ── special-round banner + curse slider (added at end of class) ──
  private bannerEl?: HTMLElement;
  private bannerTimer?: number;
  /**
   * Loud, centered round banner for special rounds / difficulty tiers. `color`
   * is any CSS color (used for the glow + underline). Auto-dismisses after a
   * couple seconds; calling again retriggers the pop.
   */
  showRoundBanner(name: string, color: string) {
    if (!this.bannerEl) {
      this.bannerEl = document.createElement("div");
      this.bannerEl.id = "round-banner";
      this.root.appendChild(this.bannerEl);
    }
    const el = this.bannerEl;
    el.style.cssText =
      "position:fixed;left:0;right:0;top:22%;text-align:center;z-index:40;pointer-events:none;" +
      "font-family:inherit;font-weight:900;font-size:min(11vw,84px);letter-spacing:3px;" +
      `color:${color};text-shadow:0 0 18px ${color},0 3px 0 rgba(0,0,0,0.55);` +
      "transition:opacity .25s,transform .25s;opacity:0;transform:scale(0.82);";
    el.textContent = name;
    // force a reflow so the entrance transition fires on retrigger
    void el.offsetWidth;
    el.style.opacity = "1";
    el.style.transform = "scale(1)";
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "scale(1.12)";
    }, 1900);
  }

  private tintEl?: HTMLElement;
  /** Full-screen mood tint for special rounds (pass null to clear). A soft
   *  radial vignette in the given CSS color — cheap, no shader work. */
  setScreenTint(color: string | null) {
    if (!this.tintEl) {
      this.tintEl = document.createElement("div");
      this.tintEl.id = "round-tint";
      this.tintEl.style.cssText =
        "position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;" +
        "transition:opacity .6s;mix-blend-mode:multiply;";
      this.root.appendChild(this.tintEl);
    }
    if (!color) {
      this.tintEl.style.opacity = "0";
      return;
    }
    this.tintEl.style.background = `radial-gradient(ellipse at center, transparent 38%, ${color} 140%)`;
    this.tintEl.style.opacity = "0.55";
  }

  private curseValEl?: HTMLElement;
  private curseCb?: (dir: number) => void;
  /**
   * Risk→reward Curse slider, shown in the in-game HUD (top area, by the round
   * pill). `onAdjust(dir)` fires with -1/+1 when the player nudges it between
   * rounds; the game clamps + reflects the new value via setCurse().
   */
  buildCurseSlider(onAdjust: (dir: number) => void) {
    this.curseCb = onAdjust;
    let box = document.getElementById("curse-slider");
    if (!box) {
      box = document.createElement("div");
      box.id = "curse-slider";
      box.style.cssText =
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:12;" +
        "display:none;align-items:center;gap:6px;font-family:inherit;font-weight:700;" +
        "background:rgba(18,12,20,0.62);border:1px solid #c0452f;border-radius:999px;" +
        "padding:4px 8px;color:#ffb3a3;font-size:13px;";
      box.innerHTML =
        `<button id="curse-dn" style="width:22px;height:22px;border:none;border-radius:50%;` +
        `cursor:pointer;font:inherit;font-weight:900;background:#3a2228;color:#ffb3a3;">−</button>` +
        `<span style="opacity:0.85;">☠ Curse</span><span id="curse-val">1.0×</span>` +
        `<button id="curse-up" style="width:22px;height:22px;border:none;border-radius:50%;` +
        `cursor:pointer;font:inherit;font-weight:900;background:#5a1f1f;color:#ffd0c0;">+</button>`;
      this.root.appendChild(box);
      (box.querySelector("#curse-dn") as HTMLButtonElement).addEventListener("click", () => this.curseCb?.(-1));
      (box.querySelector("#curse-up") as HTMLButtonElement).addEventListener("click", () => this.curseCb?.(1));
    }
    this.curseValEl = box.querySelector("#curse-val") as HTMLElement;
  }
  /** Reflect the current curse value + reward multiplier on the slider chip. */
  setCurse(value: number, rewardMul: number) {
    if (this.curseValEl) this.curseValEl.textContent = `${value.toFixed(2)}× · +${Math.round((rewardMul - 1) * 100)}%`;
  }
  /** Show/hide the curse slider (shown during intermissions / pre-round only). */
  setCurseVisible(on: boolean) {
    const box = document.getElementById("curse-slider");
    if (box) box.style.display = on ? "flex" : "none";
  }

  // ───────────────────────── PET DEPTH display helpers ─────────────────────────
  // (Added at END of class per the pets-tab ownership boundary.)

  // Inline styles keep the depth UI self-contained (no style.css dependency).
  private static readonly CHIP = "display:inline-block;padding:1px 6px;margin:1px 3px 1px 0;border-radius:8px;font-size:10px;line-height:1.5;";

  /** A row of filled/empty stars for a pet's dupe-ascension level (owned only). */
  private petStarRow(r: PetRow): string {
    if (!r.owned || !r.maxStars) return "";
    const filled = Math.max(0, Math.min(r.maxStars, r.stars ?? 0));
    if (filled <= 0 && !r.canStar) return "";
    let s = "";
    for (let i = 0; i < r.maxStars; i++) s += i < filled ? "★" : "☆";
    return `<span class="pet-stars" title="${filled}/${r.maxStars} stars" style="color:#ffd24a;font-size:11px;letter-spacing:1px;">${s}</span>`;
  }

  /** Active-squad role tally + live synergy bonuses + collection progress, shown
   *  at the top of the Pets tab. Empty-safe (renders a hint when no squad). */
  private petSquadPanel(squad?: PetSquadInfo): string {
    if (!squad) return "";
    const C = Hud.CHIP;
    const bonusChips = squad.bonuses.length
      ? squad.bonuses.map((b) => `<span style="${C}background:rgba(199,146,234,0.22);color:#e9d6ff;">✦ ${b}</span>`).join("")
      : `<span style="${C}opacity:0.6;">Pair up roles for squad synergies</span>`;
    const pct = squad.total ? Math.round((squad.collected / squad.total) * 100) : 0;
    const next = squad.nextMilestone
      ? `<span style="font-size:10px;opacity:0.8;margin-left:8px;">Next: own ${squad.nextMilestone.own} → +${squad.nextMilestone.essence} ✦</span>`
      : `<span style="font-size:10px;opacity:0.8;margin-left:8px;">Collection complete ✦</span>`;
    // The actual squad as filled + empty SLOTS. Each filled slot is a clickable
    // chip with a ✕ that benches that pet; empty slots prompt to add one.
    const cap = squad.cap ?? 5;
    const members = squad.members ?? [];
    const slots: string[] = [];
    for (let i = 0; i < cap; i++) {
      const m = members[i];
      if (m) {
        slots.push(
          `<span class="squad-slot" data-kick="${m.id}" title="Bench ${m.name}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;cursor:pointer;background:color-mix(in srgb, ${m.color} 22%, rgba(0,0,0,0.3));border:1px solid color-mix(in srgb, ${m.color} 60%, transparent);font-size:11px;font-weight:700;">${m.icon} ${m.name}<span style="opacity:0.7;font-weight:900;margin-left:2px;">✕</span></span>`,
        );
      } else {
        slots.push(`<span style="display:inline-flex;align-items:center;justify-content:center;padding:3px 10px;border-radius:999px;border:1px dashed rgba(255,255,255,0.22);font-size:11px;opacity:0.5;">+ empty</span>`);
      }
    }
    return `<div style="margin:6px 0 10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span style="font-weight:700;font-size:11px;opacity:0.85;">Active Squad</span><span style="font-size:10px;opacity:0.6;">${members.length}/${cap} · tap ✕ to bench</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${slots.join("")}</div>
      <div style="margin-bottom:4px;">${bonusChips}</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="flex:0 0 90px;height:6px;border-radius:3px;background:rgba(255,255,255,0.12);overflow:hidden;display:inline-block;"><span style="display:block;height:100%;width:${pct}%;background:#ffd24a;"></span></span>
        <span style="font-size:10px;opacity:0.85;">${squad.collected}/${squad.total} collected</span>${next}
      </div>
    </div>`;
  }
}
