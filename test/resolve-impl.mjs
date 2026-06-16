import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(url))) {
        const tsUrl = new URL(specifier + ".ts", context.parentURL);
        if (existsSync(fileURLToPath(tsUrl))) return next(specifier + ".ts", context);
      }
    } catch {}
  }
  return next(specifier, context);
}
