import * as THREE from "three";
import { JUICE } from "./config";

/**
 * Pooled floating combat text (damage numbers, "+points", crit pops). Each is a
 * canvas-textured sprite that rises and fades, then returns to the pool. Capped
 * so late-wave crowds can't spawn thousands and tank the framerate.
 */
const MAX_NUMBERS = 60;

/** Visual tier for a pop: plain, combo-scaled, or crit (bigger + distinct). */
export type PopTier = "normal" | "combo" | "crit";

interface FloatText {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseX: number; // resting sprite width (for the punch-out ease)
  baseY: number;
}

export class FloatingText {
  private pool: FloatText[] = [];
  private active: FloatText[] = [];
  // One reusable canvas/texture per distinct text+color avoids per-spawn churn.
  // Stores the canvas aspect so the sprite can size to the text (no clipping).
  private cache = new Map<string, { tex: THREE.Texture; aspect: number }>();

  constructor(private scene: THREE.Scene) {}

  private texture(text: string, color: string): { tex: THREE.Texture; aspect: number } {
    const key = `${text}|${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    // Size the canvas to the actual text (+ padding for the outline) so wide pops
    // like "💀2975" never overflow a fixed box and get clipped. 48px for a crisp
    // texture; the sprite's world height is constant, so text size is unchanged.
    const FONT = 48;
    const STROKE = 7;
    const PAD = STROKE + 8; // margin so the outline + glyph extents never clip
    const font = `bold ${FONT}px system-ui, sans-serif`;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;
    const tw = Math.ceil(measure.measureText(text).width);
    const c = document.createElement("canvas");
    c.width = tw + PAD * 2;
    c.height = FONT + PAD * 2;
    const g = c.getContext("2d")!;
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = STROKE;
    g.lineJoin = "round";
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(text, c.width / 2, c.height / 2);
    g.fillStyle = color;
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Sprites don't need mipmaps; generating them makes the GPU upload far more
    // expensive (a per-new-texture stall — the cause of mid-play frame hitches).
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    const entry = { tex, aspect: c.width / c.height };
    this.cache.set(key, entry);
    return entry;
  }

  /**
   * Spawn rising text at a world position. `tier` upgrades crit/combo pops with
   * a distinct color + bigger size; `crit` is kept for back-compat (= "crit").
   * The text gets a brief punch-out (eases from popPunch→1) and a sideways arc.
   */
  spawn(pos: THREE.Vector3, text: string, color: string, scale = 1, tier: PopTier | boolean = "normal") {
    const t: PopTier = tier === true ? "crit" : tier === false ? "normal" : tier;
    // tiered colour/size override (caller's explicit color still wins for plain)
    const col = t === "crit" ? JUICE.critColor : t === "combo" ? JUICE.comboColor : color;
    const tierScale = t === "crit" ? JUICE.critScale : t === "combo" ? JUICE.comboScale : 1;
    if (this.active.length >= MAX_NUMBERS) {
      // recycle the oldest rather than exceed the cap
      const oldest = this.active.shift();
      if (oldest) this.retire(oldest);
    }
    let ft = this.pool.pop();
    if (!ft) {
      // depthWrite:false + toneMapped:false keep the ambient-occlusion (GTAO)
      // pass from darkening the transparent quad into a black box.
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new THREE.Sprite(mat);
      ft = { sprite, vel: new THREE.Vector3(), life: 0, maxLife: 0, baseX: 0, baseY: 0 };
    }
    const mat = ft.sprite.material as THREE.SpriteMaterial;
    const { tex, aspect } = this.texture(text, col);
    mat.map = tex;
    mat.opacity = 1;
    const s = tierScale * scale;
    // Constant world height; width follows the text aspect so nothing is squished
    // or clipped regardless of digit count / icons.
    ft.baseY = 0.7 * s;
    ft.baseX = ft.baseY * aspect;
    // start punched-out; update() eases back to the resting size for a pop.
    ft.sprite.scale.set(ft.baseX * JUICE.popPunch, ft.baseY * JUICE.popPunch, 1);
    ft.sprite.position.copy(pos);
    ft.sprite.position.y += 1.6;
    ft.vel.set((Math.random() - 0.5) * JUICE.popArc, 3.2 + Math.random(), (Math.random() - 0.5) * JUICE.popArc);
    ft.life = ft.maxLife = t === "crit" ? 1.0 : 0.75;
    ft.sprite.visible = true;
    this.scene.add(ft.sprite);
    this.active.push(ft);
  }

  private retire(ft: FloatText) {
    ft.sprite.visible = false;
    this.scene.remove(ft.sprite);
    this.pool.push(ft);
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ft = this.active[i];
      ft.life -= dt;
      ft.vel.y -= 4 * dt; // gentle gravity
      ft.sprite.position.addScaledVector(ft.vel, dt);
      const k = ft.life / ft.maxLife;
      (ft.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, k * 1.5));
      // punch-out ease: scale overshoots on spawn, settles to base over popPunchTime
      const age = ft.maxLife - ft.life;
      if (age < JUICE.popPunchTime) {
        const p = 1 + (JUICE.popPunch - 1) * (1 - age / JUICE.popPunchTime);
        ft.sprite.scale.set(ft.baseX * p, ft.baseY * p, 1);
      } else if (ft.sprite.scale.x !== ft.baseX) {
        ft.sprite.scale.set(ft.baseX, ft.baseY, 1);
      }
      if (ft.life <= 0) {
        this.retire(ft);
        this.active.splice(i, 1);
      }
    }
  }

  clear() {
    for (const ft of this.active) this.retire(ft);
    this.active.length = 0;
  }
}
