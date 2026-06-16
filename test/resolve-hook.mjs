/**
 * Node ESM customization-hook registrar used by `npm run test:house`.
 *
 * The src/ code uses extensionless relative imports (e.g. `import { x } from
 * "./palette"`) that Vite/tsc resolve via `moduleResolution: bundler`, but
 * Node's runtime ESM loader does not. This registers a resolve hook
 * (resolve-impl.mjs) that rewrites a bare relative specifier `./x` -> `./x.ts`
 * when the literal target does not exist but a `.ts` sibling does. Built-in
 * Node API only (no new dependency).
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
register("./resolve-impl.mjs", pathToFileURL(here + "/"));
