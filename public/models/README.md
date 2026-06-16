# Models — drop your GLBs here

The game loads character models from this folder. **If a file is missing, the game
falls back to the primitive toy shapes** — so it always runs. Add models to upgrade
the look.

Expected files (see `src/assets.ts` → `MANIFEST`):

| File                 | Used for | Suggested KayKit pack |
| -------------------- | -------- | --------------------- |
| `player.glb`         | The hero | **KayKit – Adventurers** (e.g. Knight / Rogue / Mage) |
| `zombie.glb`         | Undead   | **KayKit – Skeletons** (e.g. Skeleton Minion) |

## Where to get KayKit assets (free / donationware, CC0-ish)

- KayKit packs by Kay Lousberg: https://kaylousberg.itch.io/
  - **KayKit Skeletons** — rigged skeletons with Idle / Walk / Attack / Death clips.
  - **KayKit Adventurers** / **Character Pack** — rigged heroes with the same clip set.
- Download the pack, grab a character `.glb` (or export one from the `.blend` /
  `.gltf`), and save it here with the filename from the table above.

> All KayKit characters share the same skeleton + animation names, so any character
> `.glb` works for either slot.

## How animations are picked

We don't hard-code clip names. `src/assets.ts` fuzzy-matches each GLB's animation
clips to four logical states by keyword:

| State    | Matches clip names containing… |
| -------- | ------------------------------- |
| `idle`   | `idle` |
| `walk`   | `walk`, `walking`, `run`, `running`, `move` |
| `attack` | `attack`, `melee`, `hit`, `punch`, `chop`, `slash`, `swing`, `cast` |
| `death`  | `death`, `die`, `dead`, `defeat`, `fall` |

So KayKit's `Idle`, `Walking_A`, `Death_A`, etc. are picked up automatically.

## If a model looks too big / small / rotated

Tweak its entry in `MANIFEST` (`src/assets.ts`):

```ts
player: { url: "models/player.glb", scale: 1.0, yawOffset: 0 },
```

- `scale` — uniform scale (the world figure is ~1.8 units tall).
- `yawOffset` — radians to rotate if the model faces the wrong way (try `Math.PI`).
