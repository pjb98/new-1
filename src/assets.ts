import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/** Logical animation states the game asks for. */
export type AnimState = "idle" | "walk" | "attack" | "death";

/** Common shape for anything an entity can drive: GLB `Character` or `VoxelChar`. */
export interface CharacterRig {
  readonly root: THREE.Object3D;
  play(state: AnimState, opts?: { once?: boolean }): void;
  update(dt: number): void;
  hasAnim(state: AnimState): boolean;
}

/** Keyword groups used to fuzzy-match a GLB's clip names to our states.
 *  KayKit (and most packs) name clips differently, so we match loosely. */
const ANIM_KEYWORDS: Record<AnimState, string[]> = {
  idle: ["idle"],
  walk: ["walk", "walking", "run", "running", "move"],
  attack: ["attack", "melee", "hit", "punch", "chop", "slash", "swing", "cast"],
  death: ["death", "die", "dead", "defeat", "fall"],
};

interface ModelDef {
  url: string;
  scale: number;
  /** Extra yaw (radians) if the model's "forward" isn't +Z. */
  yawOffset: number;
}

/**
 * Drop KayKit (or any) GLB files into `public/models/` with these names.
 * See public/models/README.md. Missing files fall back to primitive shapes,
 * so the game always runs.
 */
export const MANIFEST: Record<string, ModelDef> = {
  player: { url: "models/player.glb", scale: 1.0, yawOffset: 0 },
  zombie: { url: "models/zombie.glb", scale: 1.0, yawOffset: 0 },
};

interface Template {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  def: ModelDef;
}

/** A live, animated instance cloned from a loaded template. */
export class Character {
  readonly root: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: Partial<Record<AnimState, THREE.AnimationClip>> = {};
  private current?: THREE.AnimationAction;
  private currentState?: AnimState;

  constructor(template: Template) {
    this.root = cloneSkinned(template.scene);
    this.root.scale.setScalar(template.def.scale);
    this.root.rotation.y = template.def.yawOffset;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        m.frustumCulled = false; // skinned bounds can be wrong; avoid pop-out
      }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.resolveClips(template.animations);
    this.play("idle");
  }

  hasAnim(state: AnimState): boolean {
    return !!this.clips[state];
  }

  private resolveClips(animations: THREE.AnimationClip[]) {
    for (const state of Object.keys(ANIM_KEYWORDS) as AnimState[]) {
      const kws = ANIM_KEYWORDS[state];
      const found = animations.find((c) => {
        const n = c.name.toLowerCase();
        return kws.some((k) => n.includes(k));
      });
      if (found) this.clips[state] = found;
    }
    // Fallback: if there's no idle, use the first clip so something plays.
    if (!this.clips.idle && animations.length) this.clips.idle = animations[0];
  }

  play(state: AnimState, opts: { once?: boolean } = {}) {
    if (state === this.currentState) return;
    const clip = this.clips[state] ?? this.clips.idle;
    if (!clip) return;
    this.currentState = state;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.enabled = true;
    if (opts.once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.fadeIn(0.18).play();
    if (this.current && this.current !== next) this.current.fadeOut(0.18);
    this.current = next;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** Loads GLB templates up front (best-effort) and mints Character instances. */
export class AssetManager {
  private loader = new GLTFLoader();
  private templates = new Map<string, Template>();

  /** Load everything in the manifest. Missing/failed files are skipped. */
  async loadAll(): Promise<void> {
    const jobs = Object.entries(MANIFEST).map(async ([key, def]) => {
      try {
        const gltf = await this.loader.loadAsync(def.url);
        this.templates.set(key, { scene: gltf.scene, animations: gltf.animations, def });
      } catch {
        // Expected until the user drops GLBs in public/models/ — fall back.
        console.info(`[assets] no model for "${key}" (${def.url}); using primitive.`);
      }
    });
    await Promise.allSettled(jobs);
  }

  has(key: string): boolean {
    return this.templates.has(key);
  }

  /** Build an animated instance for `key`, or null if the model isn't loaded. */
  createCharacter(key: string): Character | null {
    const t = this.templates.get(key);
    return t ? new Character(t) : null;
  }
}
