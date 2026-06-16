# Tiny Dead — Cozy Crypt Survival

A toy-diorama take on round-based zombie survival. The soft-lit, chunky charm of
[Kintara](https://x.com/playkintara) and [Tiny Worlds](https://x.com/tinyworldsapp)
fused with the escalating dread and point economy of **Call of Duty: Zombies**.

Built with **Three.js** + **TypeScript** + **Vite**.

> See [`DESIGN.md`](./DESIGN.md) for the full game design (pillars, art direction,
> systems, and roadmap).

![status](https://img.shields.io/badge/stage-playable%20prototype-ffcf52)

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

### Play in the browser (GitHub Pages)

A workflow (`.github/workflows/deploy.yml`) builds and publishes the game on every
push. **One-time setup:** in the GitHub repo go to **Settings → Pages → Build and
deployment → Source: "GitHub Actions"**. After the next push, the live URL appears
in the Actions run (and under Settings → Pages) — open it on any device.

## Online co-op (up to 4)

The game supports host-authoritative online co-op. There are two pieces:

1. **The relay server** (`server/`) — a small Node WebSocket server that manages
   rooms by share-code. It can't run on GitHub Pages; deploy it once to a host
   that gives you a `wss://` URL (Render blueprint included):
   ```bash
   cd server && npm install && npm run dev   # local: ws://localhost:8080
   ```
   See [`server/README.md`](./server/README.md) for Render/Fly/Railway steps.

2. **The client** finds the relay at **runtime** (no rebuild needed), in order:
   - `?server=wss://your-relay` query param (saved to localStorage for next time),
   - a URL set via the **⚙ Co-op server** link on the title screen,
   - the `VITE_SERVER_URL` build var,
   - the built-in default.

   So after deploying a relay you can just open `…/?server=wss://your-relay` once,
   or paste the URL into the ⚙ link — no Pages rebuild required. (You can still
   bake a default with the `VITE_SERVER_URL` repo Variable.)

   The free-tier relay cold-starts when idle, so Host/Join ping `/health` to wake
   it and retry the connect for ~55s. If it never connects, the service is down —
   redeploy `server/` (it has a Dockerfile + Render blueprint; works on
   Render/Railway/Fly/Koyeb).

Then on the title screen: **Host Co-op** prints a 4-letter room code; friends
pick **Join**, type the code, and drop into your world. One player (the host) is
the authoritative simulation; everyone shares the round, the horde, and a **team
points pool**. Solo play needs none of this.

Guests use **client-side prediction**: a guest moves its own character locally
at 60fps and softly reconciles to the host's authoritative position (snapping
only on big desyncs), so movement feels responsive instead of stepping at the
30Hz snapshot rate. Remote players + zombies are interpolated.

Guests are full participants: they have their own weapon inventory and can
**buy from the Mystery Box / wall-buys, swap weapons (Q), Pack-a-Punch, grab
perks, and chew Gobblegum**, with buy confirmations pushed back to them. Their
own ammo HUD + buy prompts are driven by the host snapshot. The free relay can
cold-start, so Host/Join pings the server's health endpoint first and waits up
to ~45s. (Known limits: guests don't yet see the boss bar / gum timers, and
their level-up picks are host-only.)

## Controls

| Input            | Action            |
| ---------------- | ----------------- |
| **W A S D**      | Move              |
| **Mouse**        | Aim               |
| **Left click**   | Fire (hold = auto)|
| **R**            | Reload            |
| **E** / **Space**| Interact / buy    |
| **Q**            | Swap weapon       |
| **P** / **Esc**  | Pause             |
| **M**            | Mute / unmute     |

## What's in the prototype

- Cozy diorama arena: soft lighting, gentle bloom, fog, chunky low-poly props.
- Player movement, mouse aiming, shooting, reloading, health + COD-style regen.
- Round-based zombie director with scaling count / HP / speed and intermissions.
- Points economy: earn on hits, kills, and surviving rounds.
- **Mystery Box** (random weapon gamble), a **wall-buy** weapon, and **two perk pads**
  (Tough = more HP, Quick = faster movement + reload).
- HUD: round, points, health, weapon + ammo, interaction prompts; start / game-over flow.

### Weapons & the Mystery Box
- **14 guns**, each with a **distinct voxel model** the hero visibly holds
  (`gunModels.ts`) and its own **tracer color/size**. Includes wacky ones:
  **Confetti Cannon** (rainbow spray), **Fish Slapper** (huge knockback),
  **Rubber Chicken** (splat bomb), **Bee Swarm Jar** (homing bees),
  **Spud-o-Matic**, and **The Quacker** (BFG screen-wiper).
- Behaviors: per-weapon knockback, homing, ricochet bounces, and rainbow tracers.
- The **Mystery Box** (`interactables.ts`) is a COD-style **treasure chest**: the
  lid springs open, weapon models tumble up and cycle fast→slow, then land on the
  one you win (which rises and glows) before the lid closes.

### Game feel & juice
- **Procedural audio** (`audio.ts`) — every sound is synthesized live with the Web
  Audio API (no asset files): gunfire, hit ticks, crit pops, zombie groans, kill
  thuds, explosions, pickup jingles, buy/deny blips, a round-start sting, and an
  escalating ambient drone. Press **M** to mute.
- **Floating combat text** (`feedback.ts`) — pooled, billboarded damage / "+points"
  / CRIT numbers that rise and fade (capped for performance).
- **Hit feedback** — white hit-flash on zombies, knockback shove, muzzle flash, and
  brief **hit-stop** (sim micro-freeze) on crits / combo kills for impact weight.
- **Center-hit crits** — precise shots (near the body axis) deal ×2 and pop "CRIT".
- **Kill-combo multiplier** (`combo.ts`) — chaining kills ramps a points multiplier
  (up to ×5) shown with a draining HUD bar; lapses if you stop killing.

### Progression hooks (the "addicting" loops)
- **Meta-progression** (`save.ts`, `meta.ts`) — runs bank **Essence** (saved to
  localStorage, even on death); spend it in the tabbed menu shop. Personal best
  round/score is tracked and celebrated.
- **Cosmetic skins** (`cosmetics.ts`) — visual-only hero recolors bought with
  Essence and equipped from the **Skins** tab (no balance impact).
- **Challenges** (`challenges.ts`) — one-time goals (lifetime kills/crits/bosses,
  reach round 10/15, flawless boss kill) that pay Essence; progress shown on the
  **Challenges** tab. Run stats are tracked live and settled on death.
- **Behavior upgrades** (`upgrades.ts`, `mods.ts`) — beyond flat stats, level-up
  cards can grant **multishot, piercing, ricochet, homing, explosive rounds,
  chain-reaction kills, chain lightning, frostbite (slow), thorns, dodge, heal
  nova, adrenaline**, and legendary combos (Stormcaller, Swarm Lord) that define
  a build.
- **Level-up picker** (`upgrades.ts`, `mods.ts`) — clear a round and choose 1 of 3
  stacking upgrades on an animated card screen: icons, rarity tiers (common / rare /
  shimmering **legendary**), live stat-delta previews (e.g. `Damage 120% → 140%`), a
  **reroll** for points, and **1/2/3** keyboard picks. All stats funnel through a
  single `RunMods` bundle that both meta + level-ups write to.
- **Bosses** — every 5th round spawns a boss with its own health bar and a loot dump.
- **Loot drops** (`drops.ts`) — kills roll a weighted table of glowing pickups
  (max ammo, bonus points, medkit, 2× points, rapid fire, insta-kill, nuke, treasure).

## Matching the cozy soft-3D art style

The Kintara / Tiny Worlds look comes from three layers, all wired up here:

1. **Characters.** By default these are **procedural voxel figures** (`voxelChar.ts`)
   — boxy body, square head with two dot-eyes — animated procedurally
   (walk/idle/attack/death). Optionally, drop **KayKit** GLBs into `public/models/`
   (`player.glb`, `zombie.glb`) and they're used instead, with animations
   fuzzy-matched by clip name. See [`public/models/README.md`](./public/models/README.md).
2. **Render / look-dev.** Image-based ambient lighting (`RoomEnvironment` env map)
   for the soft "expensive" glow, soft shadows, gentle bloom, ACES tone mapping,
   and a **tilt-shift + vignette** post pass for the "miniature diorama" feel.
3. **Materials.** High-roughness, metalness-free toy plastic lit by the env map.

## Project layout

```
src/
  main.ts           bootstrap + the Game class (loop, state machine, collisions)
  config.ts         tunable gameplay + art constants
  palette.ts        colors + shared toy/glow material helpers
  input.ts          keyboard/mouse + pointer→ground raycast
  arena.ts          the diorama world: ground, walls, props, lights, fog
  assets.ts         GLB loader + AnimationMixer wrapper (KayKit-ready, fuzzy clips)
  tiltShift.ts      tilt-shift + vignette post-processing (the "miniature" look)
  player.ts         player entity (GLB character or primitive fallback)
  zombie.ts         zombie entity + steering/separation (GLB or primitive)
  rounds.ts         RoundManager: spawn budget, scaling, intermission
  weapons.ts        weapon defs + bullet pool + firing
  interactables.ts  Mystery Box, wall-buy, perk pads
  hud.ts            DOM HUD + overlays
public/models/      drop KayKit GLBs here (see its README)
```

Roadmap / out-of-scope items (co-op, Pack-a-Punch, special enemies, buyable doors,
audio, mobile touch, leaderboards) are tracked in [`DESIGN.md`](./DESIGN.md).
