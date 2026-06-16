# Tiny Dead — Cozy Crypt Survival

> A toy-diorama take on round-based zombie survival.
> The chunky, soft-lit charm of **Kintara** and **Tiny Worlds** — fused with the
> escalating dread and point economy of **Call of Duty: Zombies**.

---

## 1. Pitch

You're a tiny figure defending a tiny world. Adorable, slightly menacing undead
shuffle in from the edges of a miniature diorama. Survive wave after wave, earn
points for every hit and kill, and spend them to open the world up: new weapons
from the Mystery Box, upgrades from the wall, and buff stations (perks) scattered
across the map. It looks like a cozy desk toy. It plays like a meat grinder.

The contrast **is** the hook: pastel lighting + bloom + chunky low-poly shapes,
wrapped around tense, greedy "one more round" survival.

---

## 2. Pillars

1. **Cozy menace.** Soft 3D, warm palette, gentle bloom, tilt-shift "miniature"
   framing. The cuteness makes the horde funnier *and* scarier.
2. **The greed loop.** COD Zombies' core tension: every point spent on a door,
   a gun, or a perk is a point not saved for the Mystery Box. Risk vs. hoard.
3. **Readable chaos.** No matter how many zombies are on screen, the player can
   always read threats, exits, and their own health at a glance.
4. **Juicy feedback.** Hit pops, kill puffs, screen-shake, satisfying reloads.
   Everything should feel like flicking a toy.

---

## 3. Art Direction — voxel isometric (a blend of Kintara × Tiny World)

References: **Kintara** (@PlayKintara — flat isometric tiled ground, cobblestone
fountain plazas, blocky square-headed characters, MMO feel) and **Tiny World**
(@tinyworldsapp / @jasonkneen, + the Claude-made **"Tiny World Builder"** artifact
— thick soft-beveled voxels, blue sky, drifting clouds). Our look fuses them:
**a flat voxel arena with a central fountain plaza, in a soft sky.**

| Element        | Direction |
| -------------- | --------- |
| **Form**       | **Voxels.** Soft lightly-beveled cubes (`RoundedBoxGeometry`), instanced per color for performance. |
| **World**      | A **flat tiled arena** (Kintara): grass + dirt paths radiating from a **cobblestone fountain plaza** at the center — the defensive core to circle while kiting. A thick dirt/stone slab underside floats in a soft sky (Tiny World). |
| **Block kit**  | Grass · Path · Dirt · Cobble · Water · House · Tree · Fence · Crop · Tuft (+ stone underside, clouds, fountain). |
| **Camera**     | **Orthographic** (true isometric, no perspective convergence), high 3/4 angle, smoothly following the player. |
| **Characters** | Kintara-style: boxy body + **square head with two dot-eyes** (player has a hat). KayKit GLBs drop in when present; blocky-box fallback otherwise. |
| **Palette**    | Saturated green grass, tan/dirt paths, gray cobble plaza, blue water + animated fountain spray, colored peaked house roofs (purple/dark/blue). |
| **Lighting**   | Bright daylight: hemisphere + warm key with soft shadows + image-based ambient (env map) for the soft glow. |
| **Sky / Post** | Gradient blue dome + drifting low-poly clouds; gentle bloom + **tilt-shift & vignette** for the miniature feel. |

---

## 4. Core Loop

```
Spawn round  →  fight horde  →  earn points  →  spend points
     ↑                                                  │
     └──────────────  intermission  ←──────────────────┘
```

- **Round (wave):** A fixed number of zombies spawn from the map edges. The round
  ends when they're all dead. Count and zombie HP scale each round.
- **Intermission:** A short breather between rounds to reposition and spend.
- **Points** are the single currency. You earn them; you spend them. No menus.

### Point economy (prototype values)

| Action            | Points |
| ----------------- | ------ |
| Hit a zombie      | +10    |
| Kill a zombie     | +50 (on top of hits) |
| Round survived    | small bonus scaling with round |

| Purchase          | Cost  |
| ----------------- | ----- |
| Wall-buy weapon   | 1000  |
| Mystery Box pull  | 950   |
| Perk: Tough (max HP) | 2500 |
| Perk: Quick (move + reload) | 2000 |

---

## 5. Systems

### 5.1 Player
- Twin-stick feel: **WASD** to move (camera-relative), **mouse** to aim, **click/hold** to fire, **R** to reload, **E/Space** to interact.
- Health regenerates COD-style after a few seconds without taking damage.
- Carries up to two weapons; swap with **Q**.

### 5.2 Weapons
Data-driven definitions (damage, fire rate, mag size, reserve ammo, pellets,
spread, projectile speed). Prototype set:
- **Peashooter** (starting pistol) — reliable, infinite reserve.
- **Buzzgun** (SMG, wall-buy) — high fire rate.
- **Scattershot** (shotgun) — pellets + spread, box-only.
- **Boomstick / Marksman** — box pool variety.
- *(Design: "Pack-a-Punch" station upgrades a weapon's damage/mag for a premium.)*

### 5.3 Zombies
- Spawn at edge nodes, path straight toward the player with light separation so
  they don't stack into one point.
- HP and (mildly) speed scale per round. Touching the player deals damage on a
  cooldown.
- Death: damage number pop, puff particle, points awarded.
- *(Design: special enemies later — a fast "sprinter," an armored "lugger.")*

### 5.4 Interactables
- **Mystery Box** — pay to roll a random weapon from the pool. Glowing, audible,
  the classic gamble. *(Design: occasionally "teddy bear" relocates the box.)*
- **Wall-buys** — fixed weapon for a fixed price, marked on the wall.
- **Perk pads** — step on + buy to gain a permanent (per-run) buff.
- *(Design: buyable doors/debris that open new areas of the map.)*

### 5.5 Rounds / Director
- `RoundManager` owns spawn budget, spawn pacing, and HP/speed scaling curves.
- Difficulty curve tuned so rounds 1–5 teach, 6–10 pressure, 11+ are survival.

---

## 6. Prototype Scope (this branch)

**In:**
- Cozy diorama arena with soft lighting + bloom.
- Player movement, aiming, shooting, reload, health + regen, death.
- Round-based zombie spawning with scaling.
- Points economy (hits, kills, round bonus).
- Mystery Box, one wall-buy, two perk pads.
- HUD: round, points, health, weapon + ammo, interaction prompts.
- Start / pause / game-over flow with restart.

**Out (future):**
- Multiplayer / co-op, Pack-a-Punch, special enemies, buyable doors, audio pass,
  meta-progression, mobile touch controls, save/leaderboard.

---

## 7. Tech

- **Three.js** for rendering (soft-3D look, postprocessing bloom).
- **TypeScript** + **Vite** for the toolchain.
- No game framework — a small, readable ECS-lite: plain classes with `update(dt)`,
  orchestrated by a single `Game` loop. Easy to read, easy to extend.

### Module map
```
src/
  main.ts           bootstrap + the Game class (loop, scene, state machine)
  config.ts         tunable gameplay + art constants
  palette.ts        colors + shared material helpers (the cozy look)
  input.ts          keyboard/mouse, pointer→ground raycast
  arena.ts          the diorama world: ground, walls, props, lights, fog
  player.ts         player entity (move, aim, health)
  zombie.ts         zombie entity + simple steering
  rounds.ts         RoundManager: spawn budget, scaling, intermission
  weapons.ts        weapon defs + bullet pool + firing
  interactables.ts  Mystery Box, wall-buy, perk pads
  hud.ts            DOM HUD + screens (start / over)
```

---

## 7b. Art pipeline — matching the reference style

Matching the cozy soft-3D look of the references is **three layers**, not just models:

1. **Models (GLB).** Low-poly, rounded, animated characters exported as `.glb`.
   We target **KayKit** packs (free, rigged, shared skeleton + clip names). They
   load from `public/models/` and are cloned per-instance with `SkeletonUtils`;
   animations are fuzzy-matched to logical states (`idle`/`walk`/`attack`/`death`)
   so exact clip names don't matter. Missing files fall back to primitives.
   *(Asset sources: KayKit · Quaternius · Kenney · Synty POLYGON.)*
2. **Render / look-dev** — *the part most people miss.* Image-based ambient light
   (`RoomEnvironment` env map via `PMREMGenerator`) is the #1 lever for the soft,
   "expensive" stylized glow. Plus soft shadows, gentle bloom, ACES tone mapping,
   and a **tilt-shift + vignette** pass that sells the "miniature diorama" feel.
3. **Materials** — high-roughness, metalness-free toy-plastic, lit by the env map.
   (A `MeshToonMaterial` ramp is an alternative for a flatter, illustrated look.)

Future look-dev: LUT color grading, a soft outline pass, baked AO/contact shadows,
and per-character material tints.

## 8. Controls

| Input            | Action            |
| ---------------- | ----------------- |
| **W A S D**      | Move              |
| **Mouse**        | Aim               |
| **Left click**   | Fire (hold = auto)|
| **R**            | Reload            |
| **E**            | Interact / buy    |
| **Q**            | Swap weapon       |
| **P / Esc**      | Pause             |
