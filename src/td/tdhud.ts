/**
 * Tower-Defense HUD — a self-contained DOM overlay (no THREE).
 *
 * Pure DOM + TypeScript. It owns nothing about the game state: each frame the
 * integrator calls `update(state)` with a plain snapshot and the HUD diff-renders
 * (only touching the DOM when a value actually changed). It exposes optional
 * callbacks (onBuild / onCall / onUpgrade / onSell / onTarget) for its buttons,
 * but binds NO global keys — the integrator owns input. Hotkey glyphs on the
 * palette are purely informative.
 *
 * Driving it:
 *   const hud = new TdHud(document.getElementById("ui")!, {
 *     onBuild: (i) => placeTower(i),
 *     onCall:  () => callWaveEarly(),
 *   });
 *   hud.setTowers([{ name: "Arrow", cost: 50, key: "1", color: 0x7fd4ff }, ...]);
 *   hud.update(state);          // every frame
 *   hud.banner("Wave 5 — BOSS");
 *   hud.showTowerPanel({ name: "Arrow", tier: 2, target: "First",
 *                        upgradeCost: 80, sellValue: 35 });  // at an owned tower
 *   hud.showTowerPanel(null);   // back to the build palette
 *   hud.destroy();
 *
 * Visual language mirrors the game's other UI modules (#bw-shop, #td-hud in
 * style.css): dark warm translucent panels, rounded corners, gold/teal accents,
 * drop shadows, tabular-nums numbers. CSS is injected once, scoped under #tdh.
 */

/** A single buildable tower entry shown in the bottom palette. */
export interface TdTower {
  /** Display name (e.g. "Arrow"). */
  name: string;
  /** Gold cost to place. */
  cost: number;
  /** Informative hotkey glyph (e.g. "1"); the HUD does not bind it. */
  key: string;
  /** Accent colour as a 0xRRGGBB number; tints the icon + card. */
  color: number;
  /** Signature-ability headline (e.g. "Chain Arc"), shown on the card. */
  ability?: string;
}

/** Info for the owned-tower panel (upgrade / sell / target). */
export interface TdTowerInfo {
  name: string;
  /** 1-based upgrade tier. */
  tier: number;
  /** Highest tier reachable (for the "T3/T4" pip display). */
  maxTier?: number;
  /** Current targeting mode label (e.g. "First", "Strong", "Close"). */
  target: string;
  /** Gold to upgrade, or null when maxed. */
  upgradeCost: number | null;
  /** Gold refunded on sell. */
  sellValue: number;
  /** Signature ability headline; unlocked flag tells the HUD to highlight it. */
  ability?: string;
  abilityUnlocked?: boolean;
}

/** Plain per-frame snapshot the HUD renders from. */
export interface TdHudState {
  mode: "solo" | "duel";
  gold: number;
  wave: number;
  totalWaves?: number;
  betweenWaves: boolean;
  earlyCallBonus: number;
  lives?: number;
  playerHp?: number;
  botHp?: number;
  income?: number;
  over: boolean;
  win: boolean;
  /** Kill-streak combo meter (solo/endless). 0 = no active streak. */
  combo?: number;
  /** Live combo gold/score multiplier (e.g. 2.4 → ×2.4). */
  comboMult?: number;
  /** Running run score. */
  score?: number;
}

/** Optional callbacks fired by the HUD's buttons. */
export interface TdHudOpts {
  onBuild?: (tower: TdTower, index: number) => void;
  onCall?: () => void;
  onUpgrade?: () => void;
  onSell?: () => void;
  onTarget?: () => void;
  /** Always-visible "✕ Leave" button (mobile has no Escape key). */
  onLeave?: () => void;
}

const STYLE_ID = "tdh-style";
const STYLE_CSS = `
#tdh {
  position: absolute; inset: 0; z-index: 36; pointer-events: none;
  font-family: inherit; color: #f1ece1;
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
#tdh * { box-sizing: border-box; }

/* ── always-visible leave button (mobile has no Escape) ───────────────────── */
#tdh .tdh-leave {
  position: absolute; top: 14px; right: 14px; pointer-events: auto; cursor: pointer;
  font: inherit; font-weight: 800; font-size: 14px; color: #ff9c8c;
  padding: 8px 13px; border-radius: 12px; -webkit-tap-highlight-color: transparent;
  background: rgba(34,20,18,0.88); border: 1.5px solid rgba(255,138,122,0.42);
  box-shadow: 0 6px 18px rgba(0,0,0,0.36); backdrop-filter: blur(4px);
  transition: transform 0.1s, background 0.12s, border-color 0.12s;
}
#tdh .tdh-leave:hover { background: rgba(54,26,22,0.92); border-color: rgba(255,138,122,0.7); }
#tdh .tdh-leave:active { transform: scale(0.96); }

/* ── top status ─────────────────────────────────────────────────────────── */
#tdh .tdh-top {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 10px; align-items: stretch; max-width: 96vw;
}
#tdh .tdh-chip {
  pointer-events: auto;
  background: rgba(22,28,34,0.86); border: 1.5px solid rgba(255,255,255,0.13);
  border-radius: 14px; padding: 7px 14px; box-shadow: 0 6px 18px rgba(0,0,0,0.34);
  display: flex; flex-direction: column; gap: 2px; justify-content: center;
  backdrop-filter: blur(4px);
}
#tdh .tdh-chip .tdh-lbl {
  font-size: 10px; font-weight: 700; letter-spacing: 0.6px;
  text-transform: uppercase; color: #9fb0bc; line-height: 1;
}
#tdh .tdh-chip .tdh-val {
  font-size: 19px; font-weight: 800; line-height: 1.05;
  display: flex; align-items: center; gap: 6px;
}
#tdh .tdh-gold .tdh-val { color: #ffd24a; transition: transform 0.18s cubic-bezier(0.25,0.8,0.3,1), color 0.18s ease; transform-origin: left center; will-change: transform; }
#tdh .tdh-gold .tdh-val.tdh-pop { animation: tdh-goldpop 0.42s cubic-bezier(0.2,0.8,0.3,1); }
@keyframes tdh-goldpop {
  0%   { transform: scale(1); color: #ffd24a; }
  28%  { transform: scale(1.22); color: #fff4c4; text-shadow: 0 0 10px rgba(255,210,74,0.6); }
  100% { transform: scale(1); color: #ffd24a; text-shadow: none; }
}
#tdh .tdh-lives .tdh-val { color: #ff8a7a; transition: transform 0.16s ease; transform-origin: left center; }
#tdh .tdh-lives .tdh-val.tdh-livesdrop { animation: tdh-livesdrop 0.5s ease; }
@keyframes tdh-livesdrop {
  0%   { transform: scale(1); color: #ff8a7a; }
  20%  { transform: scale(1.18); color: #ff5a47; text-shadow: 0 0 12px rgba(255,80,60,0.7); }
  100% { transform: scale(1); color: #ff8a7a; text-shadow: none; }
}
#tdh .tdh-lives .tdh-val.tdh-livesup { animation: tdh-livesup 0.5s ease; }
@keyframes tdh-livesup {
  0%   { transform: scale(1); color: #ff8a7a; }
  25%  { transform: scale(1.12); color: #7be08a; text-shadow: 0 0 10px rgba(123,224,138,0.6); }
  100% { transform: scale(1); color: #ff8a7a; text-shadow: none; }
}
#tdh .tdh-wave .tdh-val { color: #7fd4ff; }
#tdh .tdh-income .tdh-val { color: #7be08a; }
#tdh .tdh-score .tdh-val { color: #f1ece1; }

/* combo + score live to the side; combo hides itself when there's no streak */
#tdh .tdh-combo { display: none; position: relative; overflow: hidden;
  border-color: rgba(255,150,60,0.45);
  background: linear-gradient(135deg, rgba(54,30,18,0.9), rgba(28,20,16,0.88));
}
#tdh .tdh-combo.tdh-on { display: flex; }
#tdh .tdh-combo .tdh-lbl { color: #ffb27a; }
#tdh .tdh-combo .tdh-val { color: #ff8a3a; gap: 8px; }
#tdh .tdh-combo .tdh-cstreak { font-size: 14px; font-weight: 800; color: #ffd9b0; }
#tdh .tdh-combo .tdh-cmult {
  font-size: 20px; font-weight: 900; letter-spacing: 0.3px;
  background: linear-gradient(180deg,#ffd24a,#ff8a3a); -webkit-background-clip: text;
  background-clip: text; -webkit-text-fill-color: transparent;
  transform-origin: left center; will-change: transform;
}
#tdh .tdh-combo.tdh-cpop .tdh-cmult { animation: tdh-cpop 0.4s cubic-bezier(0.2,0.8,0.3,1); }
@keyframes tdh-cpop {
  0%   { transform: scale(1); }
  35%  { transform: scale(1.4); filter: drop-shadow(0 0 8px rgba(255,160,60,0.7)); }
  100% { transform: scale(1); }
}
/* a heat bar that fills as the streak climbs */
#tdh .tdh-combo .tdh-cbar {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; transform-origin: left;
  background: linear-gradient(90deg,#ffd24a,#ff5a3a); transition: transform 0.25s ease;
}
#tdh .tdh-combo.tdh-cpop { animation: tdh-cflash 0.4s ease; }
@keyframes tdh-cflash {
  0%,100% { box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(255,140,50,0); }
  40%     { box-shadow: 0 6px 22px rgba(0,0,0,0.4), 0 0 0 4px rgba(255,140,50,0.3); }
}

/* HP bars (duel) */
#tdh .tdh-hp { min-width: 168px; }
#tdh .tdh-hp .tdh-bar {
  margin-top: 4px; height: 11px; border-radius: 999px; overflow: hidden;
  background: rgba(0,0,0,0.42); border: 1px solid rgba(255,255,255,0.1);
}
#tdh .tdh-hp .tdh-bar { position: relative; }
#tdh .tdh-hp .tdh-fill {
  height: 100%; width: 100%; border-radius: 999px;
  transition: width 0.35s cubic-bezier(0.25,0.8,0.3,1), background 0.18s ease, box-shadow 0.18s ease;
}
#tdh .tdh-hp.tdh-you .tdh-fill { background: linear-gradient(90deg,#5fe08a,#7be08a); }
#tdh .tdh-hp.tdh-you .tdh-lbl { color: #7be08a; }
#tdh .tdh-hp.tdh-bot .tdh-fill { background: linear-gradient(90deg,#b98aff,#c89bff); }
#tdh .tdh-hp.tdh-bot .tdh-lbl { color: #c89bff; }
#tdh .tdh-hp .tdh-hprow { display: flex; justify-content: space-between; align-items: baseline; }
#tdh .tdh-hp .tdh-hpnum { font-size: 13px; font-weight: 800; transition: transform 0.16s ease; transform-origin: right center; }

/* HP damage: red flash on the fill + a short shake on the whole bar */
#tdh .tdh-hp.tdh-hurt .tdh-fill {
  background: linear-gradient(90deg,#ff6a52,#ff8a7a) !important;
  box-shadow: 0 0 10px rgba(255,90,70,0.7) inset, 0 0 8px rgba(255,90,70,0.5);
}
#tdh .tdh-hp.tdh-hurt .tdh-bar { animation: tdh-shake 0.36s cubic-bezier(0.36,0.07,0.19,0.97); }
#tdh .tdh-hp.tdh-hurt .tdh-hpnum { color: #ff7a68; transform: scale(1.16); }
@keyframes tdh-shake {
  0%,100% { transform: translateX(0); }
  15% { transform: translateX(-3px); }
  30% { transform: translateX(3px); }
  45% { transform: translateX(-2px); }
  60% { transform: translateX(2px); }
  80% { transform: translateX(-1px); }
}
/* HP regen: soft green pulse on the bar */
#tdh .tdh-hp.tdh-heal .tdh-bar { animation: tdh-healpulse 0.6s ease; }
@keyframes tdh-healpulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(123,224,138,0); }
  40% { box-shadow: 0 0 0 3px rgba(123,224,138,0.35), 0 0 8px rgba(123,224,138,0.5); }
}
/* floating damage tag */
#tdh .tdh-hp .tdh-dmg {
  position: absolute; right: 0; top: -16px; font-size: 12px; font-weight: 900;
  color: #ff6a52; text-shadow: 0 1px 3px rgba(0,0,0,0.6); pointer-events: none;
  opacity: 0; white-space: nowrap;
}
#tdh .tdh-hp .tdh-dmg.tdh-show { animation: tdh-dmgfloat 0.7s ease forwards; }
@keyframes tdh-dmgfloat {
  0%   { opacity: 0; transform: translateY(4px) scale(0.8); }
  25%  { opacity: 1; transform: translateY(-2px) scale(1.05); }
  100% { opacity: 0; transform: translateY(-12px) scale(1); }
}

/* ── wave / call-wave pill ──────────────────────────────────────────────── */
#tdh .tdh-wavebar {
  position: absolute; top: 96px; left: 50%; transform: translateX(-50%);
  pointer-events: auto;
}
#tdh .tdh-pill {
  display: flex; align-items: center; gap: 10px;
  background: rgba(22,28,34,0.86); border: 1.5px solid rgba(255,255,255,0.13);
  border-radius: 999px; padding: 7px 8px 7px 16px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.34); backdrop-filter: blur(4px);
  font-size: 14px; font-weight: 700;
}
#tdh .tdh-pill.tdh-call {
  border-color: rgba(255,210,74,0.6); cursor: pointer;
  animation: tdh-glow 2.2s ease-in-out infinite, tdh-breathe 2.2s ease-in-out infinite;
}
#tdh .tdh-pill.tdh-call:hover { border-color: rgba(255,210,74,0.85); }
#tdh .tdh-pill.tdh-call:active { transform: scale(0.96); }
@keyframes tdh-glow {
  0%,100% { box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(255,210,74,0.0); }
  50%     { box-shadow: 0 6px 22px rgba(0,0,0,0.38), 0 0 0 4px rgba(255,210,74,0.16); }
}
@keyframes tdh-breathe {
  0%,100% { transform: scale(1); }
  50%     { transform: scale(1.025); }
}
/* quick highlight when the early-call bonus appears / increases */
#tdh .tdh-pill.tdh-callflash { animation: tdh-callflash 0.55s ease; }
@keyframes tdh-callflash {
  0%   { box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(255,210,74,0.0); border-color: rgba(255,210,74,0.6); }
  35%  { box-shadow: 0 6px 26px rgba(0,0,0,0.4), 0 0 0 7px rgba(255,210,74,0.32); border-color: rgba(255,232,150,0.95); }
  100% { box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(255,210,74,0.0); border-color: rgba(255,210,74,0.6); }
}
#tdh .tdh-pill .tdh-bonus.tdh-bonuspop { animation: tdh-goldpop 0.45s cubic-bezier(0.2,0.8,0.3,1); display: inline-block; }
#tdh .tdh-pill .tdh-key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; border-radius: 7px;
  background: rgba(255,210,74,0.18); border: 1px solid rgba(255,210,74,0.5);
  color: #ffd24a; font-size: 12px; font-weight: 800;
}
#tdh .tdh-pill .tdh-bonus { color: #ffd24a; font-weight: 800; }
#tdh .tdh-pill .tdh-prog {
  width: 84px; height: 8px; border-radius: 999px; margin-left: 4px;
  background: rgba(0,0,0,0.4); overflow: hidden; position: relative;
}
#tdh .tdh-pill .tdh-prog::after {
  content: ""; position: absolute; inset: 0; width: 38%;
  background: linear-gradient(90deg, transparent, rgba(127,212,255,0.85), transparent);
  animation: tdh-sweep 1.4s linear infinite;
}
@keyframes tdh-sweep { from { transform: translateX(-100%); } to { transform: translateX(264%); } }

/* ── bottom build palette ───────────────────────────────────────────────── */
#tdh .tdh-bottom {
  position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  pointer-events: auto; max-width: 96vw;
}
/* 7-tower palette: a wrapping grid (auto-fit cards) that scrolls if very narrow */
#tdh .tdh-palette {
  display: grid; gap: 8px; justify-content: center;
  grid-template-columns: repeat(7, minmax(0, 92px));
  max-width: 96vw;
}
#tdh .tdh-tower {
  position: relative; min-height: 90px;
  background: rgba(22,28,34,0.88); border: 1.5px solid rgba(255,255,255,0.12);
  border-radius: 14px; padding: 8px 6px 7px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  color: inherit; font: inherit; text-align: center;
  box-shadow: 0 6px 18px rgba(0,0,0,0.34); backdrop-filter: blur(4px);
  transition: transform 0.1s, border-color 0.12s, background 0.12s, opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
#tdh .tdh-tower:hover:not(.tdh-dim) { transform: translateY(-3px); }
#tdh .tdh-tower:active:not(.tdh-dim) { transform: translateY(-1px) scale(0.96); }
#tdh .tdh-tower.tdh-dim { opacity: 0.4; cursor: not-allowed; filter: grayscale(0.5); }
/* gentle highlight when a tower just became affordable */
#tdh .tdh-tower.tdh-justafford { animation: tdh-unlock 0.6s cubic-bezier(0.2,0.8,0.3,1); }
@keyframes tdh-unlock {
  0%   { transform: translateY(0) scale(1); box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(127,212,255,0); }
  35%  { transform: translateY(-4px) scale(1.06); box-shadow: 0 10px 24px rgba(0,0,0,0.4), 0 0 0 3px rgba(255,210,74,0.35); }
  100% { transform: translateY(0) scale(1); box-shadow: 0 6px 18px rgba(0,0,0,0.34), 0 0 0 0 rgba(127,212,255,0); }
}
#tdh .tdh-tower .tdh-key {
  position: absolute; top: 5px; left: 6px;
  min-width: 18px; height: 18px; padding: 0 4px; border-radius: 6px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18);
  font-size: 11px; font-weight: 800; color: #cfd9e0;
  display: inline-flex; align-items: center; justify-content: center;
}
#tdh .tdh-tower .tdh-ico { font-size: 26px; line-height: 1; margin-top: 4px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4)); }
#tdh .tdh-tower .tdh-tname { font-size: 12px; font-weight: 800; }
#tdh .tdh-tower .tdh-tability {
  font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
  color: #9fb0bc; line-height: 1.1; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#tdh .tdh-tower .tdh-tcost {
  font-size: 12px; font-weight: 800; color: #ffd24a;
  display: flex; align-items: center; gap: 3px; margin-top: 1px;
}
#tdh .tdh-tower.tdh-dim .tdh-tcost { color: #ff8a7a; }

/* owned-tower panel */
#tdh .tdh-towerpanel {
  display: none; align-items: center; gap: 8px;
  background: rgba(22,28,34,0.9); border: 1.5px solid rgba(255,255,255,0.14);
  border-radius: 16px; padding: 8px 12px; box-shadow: 0 8px 22px rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
}
#tdh .tdh-towerpanel .tdh-tphead { display: flex; flex-direction: column; gap: 2px; padding-right: 8px; margin-right: 2px; border-right: 1px solid rgba(255,255,255,0.12); }
#tdh .tdh-towerpanel .tdh-tpname { font-size: 14px; font-weight: 800; }
#tdh .tdh-towerpanel .tdh-tptier { font-size: 11px; font-weight: 700; color: #9fb0bc; }
/* tier ladder pips (filled = current tier, out of maxTier) */
#tdh .tdh-towerpanel .tdh-pips { display: flex; gap: 4px; align-items: center; margin-top: 1px; }
#tdh .tdh-towerpanel .tdh-pip {
  width: 9px; height: 9px; border-radius: 3px;
  background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.18);
  transition: background 0.18s ease, box-shadow 0.18s ease;
}
#tdh .tdh-towerpanel .tdh-pip.tdh-pon { background: linear-gradient(180deg,#7be08a,#5fe08a); border-color: rgba(123,224,138,0.6); }
#tdh .tdh-towerpanel .tdh-pip.tdh-pmax { background: linear-gradient(180deg,#ffd24a,#ff8a3a); border-color: rgba(255,210,74,0.7); box-shadow: 0 0 6px rgba(255,180,60,0.6); }
/* signature ability chip in the owned panel */
#tdh .tdh-towerpanel .tdh-tpability {
  display: flex; flex-direction: column; gap: 1px; padding: 4px 9px; margin-right: 2px;
  border-radius: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
}
#tdh .tdh-towerpanel .tdh-tpability .tdh-ablbl { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #8a96a0; }
#tdh .tdh-towerpanel .tdh-tpability .tdh-abname { font-size: 13px; font-weight: 800; color: #cfd9e0; }
#tdh .tdh-towerpanel .tdh-tpability.tdh-ablocked .tdh-abname { color: #8a96a0; }
#tdh .tdh-towerpanel .tdh-tpability.tdh-abon {
  border-color: rgba(255,210,74,0.6);
  background: linear-gradient(135deg, rgba(58,44,18,0.85), rgba(40,34,22,0.85));
  box-shadow: 0 0 0 1px rgba(255,210,74,0.25), 0 0 12px rgba(255,180,60,0.25);
}
#tdh .tdh-towerpanel .tdh-tpability.tdh-abon .tdh-abname {
  color: #ffe9a8; text-shadow: 0 0 8px rgba(255,200,80,0.5);
}
#tdh .tdh-towerpanel .tdh-tpability.tdh-abon .tdh-ablbl { color: #ffd24a; }
#tdh .tdh-act {
  pointer-events: auto; cursor: pointer; color: inherit; font: inherit;
  display: flex; align-items: center; gap: 7px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 11px; padding: 7px 11px; font-size: 13px; font-weight: 700;
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;
}
#tdh .tdh-act:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
#tdh .tdh-act:disabled { opacity: 0.4; cursor: not-allowed; }
#tdh .tdh-act .tdh-akey {
  min-width: 18px; height: 18px; padding: 0 4px; border-radius: 6px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18);
  font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;
}
#tdh .tdh-act.tdh-up { border-color: rgba(123,224,138,0.45); }
#tdh .tdh-act.tdh-up .tdh-cost { color: #ffd24a; }
#tdh .tdh-act.tdh-sell { border-color: rgba(255,138,122,0.4); }
#tdh .tdh-act.tdh-sell .tdh-cost { color: #7be08a; }
#tdh .tdh-act.tdh-target .tdh-cost { color: #7fd4ff; }
#tdh.tdh-owned .tdh-palette { display: none; }
#tdh.tdh-owned .tdh-towerpanel { display: flex; }

/* ── transient center banner ────────────────────────────────────────────── */
#tdh .tdh-banner {
  position: absolute; top: 30%; left: 50%; transform: translate(-50%,-50%) scale(0.85);
  padding: 14px 30px; border-radius: 18px;
  background: rgba(22,28,34,0.92); border: 2px solid rgba(255,210,74,0.7);
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  font-size: 30px; font-weight: 900; letter-spacing: 0.5px; color: #ffe9a8;
  text-shadow: 0 2px 6px rgba(0,0,0,0.5); white-space: nowrap;
  opacity: 0; pointer-events: none;
}
#tdh .tdh-banner.tdh-show { animation: tdh-banner 2.1s cubic-bezier(0.2,0.7,0.3,1) forwards; }
@keyframes tdh-banner {
  0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.62) rotate(-1.5deg); filter: blur(4px); }
  10%  { opacity: 1; transform: translate(-50%,-50%) scale(1.12) rotate(0.5deg); filter: blur(0); }
  18%  { transform: translate(-50%,-50%) scale(0.97) rotate(0deg); }
  26%  { transform: translate(-50%,-50%) scale(1.02); }
  34%  { transform: translate(-50%,-50%) scale(1); }
  78%  { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.1); filter: blur(2px); }
}
/* boss banner: warmer red accent + a pulsing alert glow */
#tdh .tdh-banner.tdh-boss {
  border-color: rgba(255,90,70,0.85); color: #ffd0c4;
  text-shadow: 0 2px 8px rgba(0,0,0,0.55), 0 0 14px rgba(255,80,60,0.45);
}
#tdh .tdh-banner.tdh-boss.tdh-show { animation: tdh-banner 2.1s cubic-bezier(0.2,0.7,0.3,1) forwards, tdh-bossglow 0.5s ease-in-out 3; }
@keyframes tdh-bossglow {
  0%,100% { box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 0 rgba(255,80,60,0); }
  50%     { box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 6px rgba(255,80,60,0.3); }
}

/* ── win / lose overlay ─────────────────────────────────────────────────── */
#tdh .tdh-over {
  position: absolute; inset: 0; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 8px;
  background: radial-gradient(ellipse at center, rgba(14,18,22,0.5), rgba(10,12,16,0.82));
  backdrop-filter: blur(3px); pointer-events: auto;
}
#tdh .tdh-over.tdh-show { display: flex; animation: tdh-fadein 0.5s ease forwards; }
@keyframes tdh-fadein { from { opacity: 0; } to { opacity: 1; } }
#tdh .tdh-over .tdh-otitle {
  font-size: 56px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 4px 14px rgba(0,0,0,0.6);
}
#tdh .tdh-over.tdh-show .tdh-otitle { animation: tdh-overtitle 0.7s cubic-bezier(0.2,0.8,0.3,1) both; }
@keyframes tdh-overtitle {
  0%   { opacity: 0; transform: scale(0.6) translateY(14px); filter: blur(6px); }
  55%  { opacity: 1; transform: scale(1.08) translateY(0); filter: blur(0); }
  100% { transform: scale(1) translateY(0); }
}
#tdh .tdh-over.tdh-win .tdh-otitle { color: #ffe08a; }
#tdh .tdh-over.tdh-lose .tdh-otitle { color: #ff8a7a; }
#tdh .tdh-over .tdh-osub { font-size: 16px; font-weight: 700; color: #c4cfd6; }
#tdh .tdh-over.tdh-show .tdh-osub { animation: tdh-oversub 0.6s ease 0.2s both; }
@keyframes tdh-oversub {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── mobile / phone ─────────────────────────────────────────────────────── */
@media (max-width: 560px) {
  /* 7 towers wrap to a tidy 4-up grid that always fits the screen width */
  #tdh .tdh-bottom { bottom: 12px; width: 100%; padding: 0 6px; }
  #tdh .tdh-palette {
    grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; max-width: 100%;
  }
  #tdh .tdh-tower { min-height: 70px; padding: 6px 3px 5px; border-radius: 12px; }
  #tdh .tdh-tower .tdh-ico { font-size: 22px; margin-top: 8px; }
  #tdh .tdh-tower .tdh-tname { font-size: 11px; }
  #tdh .tdh-tower .tdh-tability { display: none; } /* keep cards compact on phones */
  #tdh .tdh-tower .tdh-key { top: 3px; left: 3px; min-width: 15px; height: 15px; font-size: 9px; }
  /* owned panel: let the controls wrap rather than overflow off-screen */
  #tdh .tdh-towerpanel { flex-wrap: wrap; justify-content: center; max-width: 100%; }
  #tdh .tdh-act { padding: 9px 12px; } /* keep tap targets comfy */
  /* top status: allow chips to wrap so combo/score don't push off-screen */
  #tdh .tdh-top { flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 98vw; }
  #tdh .tdh-chip { padding: 5px 10px; }
  #tdh .tdh-chip .tdh-val { font-size: 16px; }
  #tdh .tdh-over .tdh-otitle { font-size: 40px; }
  #tdh .tdh-banner { font-size: 22px; padding: 10px 20px; }
}
/* very narrow phones: fall back to a single horizontal scroll row */
@media (max-width: 360px) {
  #tdh .tdh-palette {
    display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 6px;
    padding-bottom: 4px; -webkit-overflow-scrolling: touch;
  }
  #tdh .tdh-tower { flex: 0 0 64px; }
}
`;

/** Default emoji glyph per tower name (falls back to a generic turret). */
const ICONS: Record<string, string> = {
  Arrow: "\u{1F3F9}", // 🏹
  Frost: "❄️", // ❄️
  Pylon: "⚡", // ⚡
  Cannon: "\u{1F4A3}", // 💣
  Sniper: "\u{1F3AF}", // 🎯
  Tesla: "\u{1F329}\u{FE0F}", // 🌩️
  Venom: "\u{2620}\u{FE0F}", // ☠️
};
/** Generic turret fallback for any tower name not in ICONS. */
const ICON_FALLBACK = "\u{1F5FC}"; // 🗼
const GOLD = "\u{1FA99}"; // 🪙

function hex(color: number): string {
  return "#" + (color & 0xffffff).toString(16).padStart(6, "0");
}

/** Escape text destined for innerHTML (tower names/abilities are caller-supplied). */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");
}

/** Element refs for one HP bar (fill, % label, bar wrapper, floating damage tag). */
interface HpRef {
  wrap: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  num: HTMLElement;
  dmg: HTMLElement;
}

export class TdHud {
  private root: HTMLElement;
  private el: HTMLElement;
  private opts: TdHudOpts;

  // top status refs
  private topEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private livesEl!: HTMLElement;
  private waveEl!: HTMLElement;
  private incomeEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private comboStreakEl!: HTMLElement;
  private comboMultEl!: HTMLElement;
  private comboBarEl!: HTMLElement;
  private youHp!: HpRef;
  private botHp!: HpRef;

  // wave control refs
  private waveBarEl!: HTMLElement;
  private pillEl!: HTMLElement;

  // bottom refs
  private paletteEl!: HTMLElement;
  private upBtn!: HTMLButtonElement;
  private sellBtn!: HTMLButtonElement;
  private targetBtn!: HTMLButtonElement;
  private tpName!: HTMLElement;
  private tpTier!: HTMLElement;
  private tpPips!: HTMLElement;
  private tpAbility!: HTMLElement;
  private tpAbilityName!: HTMLElement;

  // banner + overlay
  private bannerEl!: HTMLElement;
  private overEl!: HTMLElement;
  private overTitle!: HTMLElement;
  private overSub!: HTMLElement;

  private towers: TdTower[] = [];
  private towerBtns: HTMLButtonElement[] = [];
  private bannerTimer: number | null = null;

  // cached prev-frame values for cheap diffing
  private prev: Partial<Record<string, string>> = {};
  private prevAffordKey = "";
  private prevTopMode: "" | "solo" | "duel" = "";

  // ── juice state ───────────────────────────────────────────────────────────
  // animated gold counter: `goldShown` eases toward `goldTarget` per frame
  private goldTarget = 0;
  private goldShown = 0;
  private goldInit = false;
  // last rendered HP per bar (for damage/regen detection)
  private prevHp: Record<string, number> = {};
  // per-tower affordability (to detect the affordable crossing)
  private prevAfford: boolean[] = [];
  // early-call bonus (to highlight when it appears / grows)
  private prevBonus = -1;
  // combo multiplier (to pop the meter when the streak climbs)
  private prevCombo = 0;

  constructor(parent: HTMLElement, opts: TdHudOpts = {}) {
    this.root = parent;
    this.opts = opts;
    this.injectStyle();

    this.el = document.createElement("div");
    this.el.id = "tdh";
    this.el.innerHTML = `
      <div class="tdh-top">
        <div class="tdh-chip tdh-hp tdh-you" data-show="duel">
          <div class="tdh-hprow"><span class="tdh-lbl">You</span><span class="tdh-hpnum">100%</span></div>
          <div class="tdh-bar"><div class="tdh-fill"></div><span class="tdh-dmg"></span></div>
        </div>
        <div class="tdh-chip tdh-hp tdh-bot" data-show="duel">
          <div class="tdh-hprow"><span class="tdh-lbl">Rival</span><span class="tdh-hpnum">100%</span></div>
          <div class="tdh-bar"><div class="tdh-fill"></div><span class="tdh-dmg"></span></div>
        </div>
        <div class="tdh-chip tdh-gold"><span class="tdh-lbl">Gold</span><span class="tdh-val">0</span></div>
        <div class="tdh-chip tdh-lives" data-show="solo"><span class="tdh-lbl">Lives</span><span class="tdh-val">0</span></div>
        <div class="tdh-chip tdh-income" data-show="duel"><span class="tdh-lbl">Income</span><span class="tdh-val">0</span></div>
        <div class="tdh-chip tdh-wave"><span class="tdh-lbl">Wave</span><span class="tdh-val">0</span></div>
        <div class="tdh-chip tdh-score" data-show="solo"><span class="tdh-lbl">Score</span><span class="tdh-val">0</span></div>
        <div class="tdh-chip tdh-combo" data-show="solo">
          <span class="tdh-lbl">Combo</span>
          <span class="tdh-val"><span class="tdh-cstreak">0</span><span class="tdh-cmult">×1.0</span></span>
          <span class="tdh-cbar"></span>
        </div>
      </div>

      <div class="tdh-wavebar">
        <div class="tdh-pill"></div>
      </div>

      <div class="tdh-bottom">
        <div class="tdh-palette"></div>
        <div class="tdh-towerpanel">
          <div class="tdh-tphead">
            <span class="tdh-tpname">Tower</span>
            <span class="tdh-tptier">Tier 1</span>
            <span class="tdh-pips"></span>
          </div>
          <div class="tdh-tpability">
            <span class="tdh-ablbl">Ability</span>
            <span class="tdh-abname">—</span>
          </div>
          <button class="tdh-act tdh-up"><span class="tdh-akey">E</span><span>upgrade</span><span class="tdh-cost"></span></button>
          <button class="tdh-act tdh-sell"><span class="tdh-akey">X</span><span>sell</span><span class="tdh-cost"></span></button>
          <button class="tdh-act tdh-target"><span class="tdh-akey">T</span><span>target</span><span class="tdh-cost"></span></button>
        </div>
      </div>

      <button class="tdh-leave" type="button">✕ Leave</button>
      <div class="tdh-banner"></div>
      <div class="tdh-over">
        <div class="tdh-otitle">Victory</div>
        <div class="tdh-osub"></div>
      </div>`;
    this.root.appendChild(this.el);

    this.topEl = this.q(".tdh-top");
    this.goldEl = this.q(".tdh-gold .tdh-val");
    this.livesEl = this.q(".tdh-lives .tdh-val");
    this.waveEl = this.q(".tdh-wave .tdh-val");
    this.incomeEl = this.q(".tdh-income .tdh-val");
    this.scoreEl = this.q(".tdh-score .tdh-val");
    this.comboEl = this.q(".tdh-combo");
    this.comboStreakEl = this.q(".tdh-cstreak");
    this.comboMultEl = this.q(".tdh-cmult");
    this.comboBarEl = this.q(".tdh-cbar");
    this.youHp = this.hpRefs(".tdh-you");
    this.botHp = this.hpRefs(".tdh-bot");

    this.waveBarEl = this.q(".tdh-wavebar");
    this.pillEl = this.q(".tdh-pill");

    this.paletteEl = this.q(".tdh-palette");
    this.upBtn = this.q(".tdh-act.tdh-up") as HTMLButtonElement;
    this.sellBtn = this.q(".tdh-act.tdh-sell") as HTMLButtonElement;
    this.targetBtn = this.q(".tdh-act.tdh-target") as HTMLButtonElement;
    this.tpName = this.q(".tdh-tpname");
    this.tpTier = this.q(".tdh-tptier");
    this.tpPips = this.q(".tdh-pips");
    this.tpAbility = this.q(".tdh-tpability");
    this.tpAbilityName = this.q(".tdh-tpability .tdh-abname");

    this.bannerEl = this.q(".tdh-banner");
    this.overEl = this.q(".tdh-over");
    this.overTitle = this.q(".tdh-otitle");
    this.overSub = this.q(".tdh-osub");

    this.upBtn.addEventListener("click", () => this.opts.onUpgrade?.());
    this.sellBtn.addEventListener("click", () => this.opts.onSell?.());
    this.targetBtn.addEventListener("click", () => this.opts.onTarget?.());
    (this.q(".tdh-leave") as HTMLButtonElement).addEventListener("click", () => this.opts.onLeave?.());
  }

  // ── public API ────────────────────────────────────────────────────────────

  /** Replace the bottom build palette contents. Affordability is applied on update(). */
  setTowers(list: TdTower[]): void {
    this.towers = list.slice();
    this.paletteEl.innerHTML = "";
    this.towerBtns = list.map((t, i) => {
      const btn = document.createElement("button");
      btn.className = "tdh-tower";
      btn.style.borderColor = `${hex(t.color)}55`;
      const ico = ICONS[t.name] ?? ICON_FALLBACK;
      const ability = t.ability
        ? `<span class="tdh-tability" style="color:${hex(t.color)}cc">${esc(t.ability)}</span>`
        : `<span class="tdh-tability"></span>`;
      btn.innerHTML = `
        <span class="tdh-key">${esc(t.key)}</span>
        <span class="tdh-ico" style="color:${hex(t.color)}">${ico}</span>
        <span class="tdh-tname">${esc(t.name)}</span>
        ${ability}
        <span class="tdh-tcost">${GOLD}${t.cost}</span>`;
      btn.addEventListener("click", () => {
        if (!btn.classList.contains("tdh-dim")) this.opts.onBuild?.(t, i);
      });
      this.paletteEl.appendChild(btn);
      return btn;
    });
    this.prevAffordKey = ""; // force re-eval next update
    this.prevAfford = []; // first eval seeds state without a spurious unlock flash
  }

  /** Swap the bottom bar to the owned-tower panel, or null to show the palette. */
  showTowerPanel(info: TdTowerInfo | null): void {
    if (!info) {
      this.el.classList.remove("tdh-owned");
      return;
    }
    this.el.classList.add("tdh-owned");
    this.tpName.textContent = info.name;
    const maxTier = info.maxTier ?? 4;
    this.tpTier.textContent = `Tier ${info.tier}/${maxTier}`;
    this.renderPips(info.tier, maxTier);

    // signature ability: highlighted once unlocked
    if (info.ability) {
      this.tpAbility.style.display = "";
      this.tpAbilityName.textContent = info.ability;
      this.tpAbility.classList.toggle("tdh-abon", !!info.abilityUnlocked);
      this.tpAbility.classList.toggle("tdh-ablocked", !info.abilityUnlocked);
    } else {
      this.tpAbility.style.display = "none";
    }

    const upCost = this.upBtn.querySelector(".tdh-cost") as HTMLElement;
    if (info.upgradeCost == null) {
      this.upBtn.disabled = true;
      (this.upBtn.querySelector("span:nth-child(2)") as HTMLElement).textContent = "maxed";
      upCost.textContent = "";
    } else {
      this.upBtn.disabled = false;
      (this.upBtn.querySelector("span:nth-child(2)") as HTMLElement).textContent = "upgrade";
      upCost.textContent = `(${GOLD}${info.upgradeCost})`;
    }
    (this.sellBtn.querySelector(".tdh-cost") as HTMLElement).textContent = `(+${info.sellValue})`;
    (this.targetBtn.querySelector(".tdh-cost") as HTMLElement).textContent = `[${info.target}]`;
  }

  /** Per-frame render. Cheap: only touches the DOM when a value changed. */
  update(s: TdHudState): void {
    // top: toggle which chips are visible for the mode (only when mode changes)
    if (s.mode !== this.prevTopMode) {
      this.prevTopMode = s.mode;
      this.topEl.querySelectorAll<HTMLElement>("[data-show]").forEach((c) => {
        c.style.display = c.dataset.show === s.mode ? "" : "none";
      });
    }

    this.renderGold(s.gold);

    const total = s.totalWaves != null ? `/${s.totalWaves}` : "";
    this.setText(this.waveEl, "wave", `${s.wave}${total}`);

    if (s.mode === "solo") {
      this.renderLives(s.lives ?? 0);
      this.setText(this.scoreEl, "score", `${s.score ?? 0}`);
      this.renderCombo(s.combo ?? 0, s.comboMult ?? 1);
    } else {
      this.setText(this.incomeEl, "income", `+${s.income ?? 0}/wave`);
      this.setHp(this.youHp, "youhp", s.playerHp);
      this.setHp(this.botHp, "bothp", s.botHp);
    }

    this.renderWave(s);
    this.renderAfford(s.gold);
    this.renderOver(s);
  }

  /** Show a big transient center banner that animates in then fades. */
  banner(text: string): void {
    this.bannerEl.textContent = text;
    // boss banners get a warmer red accent + alert glow
    this.bannerEl.classList.toggle("tdh-boss", /boss/i.test(text));
    this.bannerEl.classList.remove("tdh-show");
    void this.bannerEl.offsetWidth; // restart animation
    this.bannerEl.classList.add("tdh-show");
    if (this.bannerTimer != null) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.classList.remove("tdh-show");
      this.bannerTimer = null;
    }, 2100);
  }

  /** Remove DOM + listeners. Safe to call once. */
  destroy(): void {
    if (this.bannerTimer != null) {
      clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
    this.el.remove();
    this.towerBtns = [];
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Animated gold counter: eases the displayed number toward the real value,
   *  with a brief scale/colour pop when gold increases. */
  private renderGold(gold: number): void {
    const target = Math.max(0, Math.floor(gold));
    if (!this.goldInit) {
      // first frame: snap (no tick from 0)
      this.goldInit = true;
      this.goldTarget = target;
      this.goldShown = target;
      this.setText(this.goldEl, "gold", `${GOLD}${target}`);
      return;
    }
    if (target > this.goldTarget) {
      // gold went up — a satisfying pop on the counter
      this.retrigger(this.goldEl, "tdh-pop", 420);
    }
    this.goldTarget = target;

    // ease the shown value toward the target (~60fps; settle quickly but visibly)
    const diff = this.goldTarget - this.goldShown;
    if (diff !== 0) {
      const step = diff * 0.28;
      // ensure we always move at least 1 toward the target and snap when close
      if (Math.abs(diff) <= 1) {
        this.goldShown = this.goldTarget;
      } else {
        this.goldShown += step > 0 ? Math.max(1, step) : Math.min(-1, step);
      }
    }
    const shown = Math.round(this.goldShown);
    this.setText(this.goldEl, "gold", `${GOLD}${shown}`);
  }

  /** Solo lives with a red drop-flash / green regen-flash on change. */
  private renderLives(lives: number): void {
    const text = `❤️ ${lives}`;
    const prevRaw = this.prevHp["lives"];
    const changed = this.prev["lives"] !== text;
    this.setText(this.livesEl, "lives", text);
    if (!changed) return;
    if (prevRaw !== undefined) {
      if (lives < prevRaw) this.retrigger(this.livesEl, "tdh-livesdrop", 500);
      else if (lives > prevRaw) this.retrigger(this.livesEl, "tdh-livesup", 500);
    }
    this.prevHp["lives"] = lives;
  }

  /** Kill-streak combo meter: shows the streak count + a pulsing multiplier,
   *  hides itself entirely when there's no active streak. Cheap/diff-based. */
  private renderCombo(combo: number, mult: number): void {
    const on = combo > 0;
    const key = `${on ? 1 : 0}|${combo}|${mult.toFixed(2)}`;
    if (this.prev["__combo"] === key) return;
    this.prev["__combo"] = key;

    this.comboEl.classList.toggle("tdh-on", on);
    if (on) {
      this.comboStreakEl.textContent = `${combo}×`;
      this.comboMultEl.textContent = `×${mult.toFixed(1)}`;
      // heat bar fills toward a cap of ×5 (purely cosmetic ceiling)
      const frac = Math.max(0, Math.min(1, (mult - 1) / 4));
      this.comboBarEl.style.transform = `scaleX(${frac})`;
      // pop the meter whenever the streak grows
      if (combo > this.prevCombo) this.retrigger(this.comboEl, "tdh-cpop", 400);
    }
    this.prevCombo = combo;
  }

  /** Render the upgrade-ladder pips (filled = reached tier; top tier glows gold). */
  private renderPips(tier: number, maxTier: number): void {
    const key = `${tier}/${maxTier}`;
    if (this.prev["__pips"] === key) {
      // still rebuild if the node was emptied elsewhere; otherwise skip
      if (this.tpPips.childElementCount === maxTier) return;
    }
    this.prev["__pips"] = key;
    let html = "";
    for (let i = 1; i <= maxTier; i++) {
      const on = i <= tier;
      const max = on && i === maxTier;
      html += `<span class="tdh-pip${on ? " tdh-pon" : ""}${max ? " tdh-pmax" : ""}"></span>`;
    }
    this.tpPips.innerHTML = html;
  }

  private renderWave(s: TdHudState): void {
    const key = `${s.betweenWaves ? "b" : "a"}|${s.wave}|${s.earlyCallBonus}`;
    if (this.prev["__wavebar"] === key) return;
    this.prev["__wavebar"] = key;
    if (s.over) {
      this.waveBarEl.style.display = "none";
      return;
    }
    this.waveBarEl.style.display = "";
    if (s.betweenWaves) {
      this.pillEl.className = "tdh-pill tdh-call";
      this.pillEl.innerHTML = `
        <span class="tdh-key">SPACE</span>
        <span>Wave ${s.wave} — start now</span>
        <span class="tdh-bonus">+${s.earlyCallBonus}${GOLD}</span>`;
      this.pillEl.onclick = () => this.opts.onCall?.();
      // quick highlight when the early-call bonus first appears / grows
      if (s.earlyCallBonus > 0 && s.earlyCallBonus > this.prevBonus) {
        this.retrigger(this.pillEl, "tdh-callflash", 550);
        const bonusEl = this.pillEl.querySelector(".tdh-bonus") as HTMLElement | null;
        if (bonusEl) this.retrigger(bonusEl, "tdh-bonuspop", 450);
      }
      this.prevBonus = s.earlyCallBonus;
    } else {
      this.pillEl.className = "tdh-pill";
      this.pillEl.innerHTML = `<span>Wave ${s.wave}</span><span class="tdh-prog"></span>`;
      this.pillEl.onclick = null;
      this.prevBonus = -1;
    }
  }

  private renderAfford(gold: number): void {
    const g = Math.floor(gold);
    const key = `${g}|${this.towers.map((t) => t.cost).join(",")}`;
    if (key === this.prevAffordKey) return;
    this.prevAffordKey = key;
    this.towers.forEach((t, i) => {
      const btn = this.towerBtns[i];
      if (!btn) return;
      const affordable = g >= t.cost;
      btn.classList.toggle("tdh-dim", !affordable);
      const was = this.prevAfford[i];
      // gentle unlock highlight when a tower just crossed into affordability
      if (affordable && was === false) {
        this.retrigger(btn, "tdh-justafford", 600);
      }
      this.prevAfford[i] = affordable;
    });
  }

  private renderOver(s: TdHudState): void {
    const key = s.over ? (s.win ? "win" : "lose") : "off";
    if (this.prev["__over"] === key) return;
    this.prev["__over"] = key;
    if (!s.over) {
      this.overEl.className = "tdh-over";
      return;
    }
    this.overEl.className = `tdh-over tdh-show ${s.win ? "tdh-win" : "tdh-lose"}`;
    this.overTitle.textContent = s.win ? "Victory" : "Defeat";
    this.overSub.textContent = s.win
      ? "All waves survived."
      : s.mode === "duel"
        ? "Your base fell."
        : "Your base was overrun.";
  }

  private setHp(ref: HpRef, slot: string, hp: number | undefined): void {
    const pct = Math.max(0, Math.min(100, Math.round(hp ?? 100)));
    if (this.prev[slot] === String(pct)) return;
    const had = slot in this.prevHp;
    const prevPct = this.prevHp[slot] ?? pct;
    this.prev[slot] = String(pct);
    this.prevHp[slot] = pct;

    // width transitions smoothly via CSS; just set the target
    ref.fill.style.width = `${pct}%`;
    ref.num.textContent = `${pct}%`;

    if (!had) return; // first render: no flash

    const delta = pct - prevPct;
    if (delta < 0) {
      // damage: red flash + shake + floating "-N"
      this.retrigger(ref.wrap, "tdh-hurt", 360);
      ref.dmg.textContent = `-${-delta}`;
      this.retrigger(ref.dmg, "tdh-show", 700);
    } else if (delta > 0) {
      // regen: soft green pulse
      this.retrigger(ref.wrap, "tdh-heal", 600);
    }
  }

  /** Re-apply a one-shot animation class (forces the keyframes to restart). */
  private retrigger(el: HTMLElement, cls: string, ms: number): void {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  }

  private setText(el: HTMLElement, slot: string, text: string): void {
    if (this.prev[slot] === text) return;
    this.prev[slot] = text;
    el.textContent = text;
  }

  private hpRefs(sel: string): HpRef {
    const wrap = this.q(sel);
    return {
      wrap,
      bar: wrap.querySelector(".tdh-bar") as HTMLElement,
      fill: wrap.querySelector(".tdh-fill") as HTMLElement,
      num: wrap.querySelector(".tdh-hpnum") as HTMLElement,
      dmg: wrap.querySelector(".tdh-dmg") as HTMLElement,
    };
  }

  private q(sel: string): HTMLElement {
    return this.el.querySelector(sel) as HTMLElement;
  }

  private injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
  }
}
