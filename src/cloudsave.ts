/**
 * Client side of WALLET CLOUD-SAVE. INTENTIONALLY THIN + dependency-free.
 *
 * Players who connect a Solana wallet get their progress synced to a durable
 * Supabase backend keyed by their wallet address, so it follows them across
 * devices. This module only talks to that backend over HTTP; ALL network calls
 * are wrapped in try/catch and return null on any failure, so the game degrades
 * gracefully to localStorage-only play when offline or when no URL is set.
 *
 * TRUST MODEL: identical spirit to token.ts — the client proves wallet ownership
 * with a signed, timestamped message and the backend is authoritative. The save
 * blob itself is just opaque progress; it's re-sanitized client-side (see
 * sanitizeSave) before it's ever trusted, so a forged cloud blob can't poison
 * the economy.
 *
 * WIRE CONTRACT (fixed — matches the Supabase `save` Edge Function exactly):
 *   URL = the full Edge Function endpoint, e.g.
 *         https://<project-ref>.supabase.co/functions/v1/save
 *   A single endpoint handles two actions, both via JSON POST:
 *   - POST { action:"login", address, message, signature (base64) }
 *       → 200 { ok:true, token, save:object|null, updated:number } | 401 { ok:false, error }
 *     message MUST be exactly: `Tiny Dead save sync\naddress: <addr>\nts: <ms>`
 *     (ts = Date.now(); server allows ±5 min).
 *   - POST { action:"push", address, token, save:object, updated:number }
 *       (serialized save must be < 256 KB)
 *       → { ok:true, updated:number } | 401 { ok:false, error }
 *   The function does its OWN ed25519 wallet-sig auth (verify_jwt disabled), so
 *   no Supabase anon key is needed to call it.
 */

const LS_KEY = "tinydead.saveapi";

/** Default cloud-save endpoint — the deployed Supabase `save` Edge Function.
 *  Baked in so cloud save is live without a build var; `VITE_SAVE_URL` or a
 *  localStorage override still win (see readInit). Empty = disabled. */
// Empty = cloud save OFF by default → connecting a wallet does NOT pop a surprise
// signature. (Re-enable later via VITE_SAVE_URL / setSaveApiUrl once the Supabase
// function is confirmed deployed and we want the cross-device sync prompt back.)
const DEFAULT_SAVE_URL = "";

/** Build-time default save URL from Vite's env (VITE_SAVE_URL). Read defensively
 *  — `import.meta.env` only exists under the Vite bundler, never in plain Node
 *  (tests), so we narrow it ourselves rather than depend on vite/client types. */
function envSaveUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SAVE_URL ?? "";
}

function readInit(): string {
  // precedence: explicit localStorage override → VITE_SAVE_URL → baked default
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls) return ls;
  } catch {
    /* storage unavailable — fall through to env/default */
  }
  return envSaveUrl() || DEFAULT_SAVE_URL;
}

let apiUrl = readInit();

/** Configured cloud-save Edge Function URL (empty string = cloud save DISABLED). */
export function getSaveApiUrl(): string {
  return apiUrl;
}

/** Point the client at a deployed Supabase `save` function URL, e.g.
 *  https://<project-ref>.supabase.co/functions/v1/save. Returns the normalized URL. */
export function setSaveApiUrl(input: string): string {
  apiUrl = (input || "").trim().replace(/\/+$/, "");
  try {
    localStorage.setItem(LS_KEY, apiUrl);
  } catch {
    /* storage unavailable — session only */
  }
  return apiUrl;
}

/** True only when a save backend URL is configured (else everything no-ops). */
export function cloudEnabled(): boolean {
  return !!getSaveApiUrl();
}

/** The canonical login message the backend verifies (±5 min on ts). */
export function saveSignText(address: string, ts = Date.now()): string {
  return `Tiny Dead save sync\naddress: ${address}\nts: ${ts}`;
}

/**
 * Prove wallet ownership and fetch the stored save in one round-trip. Builds the
 * canonical message, asks the caller to sign it (so this module stays wallet-
 * agnostic), then POSTs the "login" action. Returns the session token + stored
 * save, or null on any failure (no URL, declined signature, network/HTTP error,
 * 401).
 */
export async function cloudLogin(
  address: string,
  sign: (text: string) => Promise<string | null>,
): Promise<{ token: string; save: unknown; updated: number } | null> {
  if (!apiUrl || !address) return null;
  try {
    const message = saveSignText(address);
    const signature = await sign(message);
    if (!signature) return null; // declined / can't sign
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "login", address, message, signature }),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; token?: string; save?: unknown; updated?: number }
      | null;
    if (!j || !j.ok || typeof j.token !== "string") return null;
    return {
      token: j.token,
      save: j.save ?? null,
      updated: typeof j.updated === "number" ? j.updated : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Push a save blob to the cloud with the session token from cloudLogin. Returns
 * the server's authoritative `updated` timestamp, or null on any failure (incl.
 * an expired/invalid token → 401, which the caller treats as "drop the token and
 * re-login on the next connect"). Never signs — the session token covers pushes.
 */
export async function cloudPush(
  address: string,
  token: string,
  save: object,
  updated: number,
): Promise<number | null> {
  if (!apiUrl || !address || !token) return null;
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "push", address, token, save, updated }),
    });
    if (!res.ok) return null; // 401 etc → caller drops the token
    const j = (await res.json().catch(() => null)) as { ok?: boolean; updated?: number } | null;
    if (!j || !j.ok) return null;
    return typeof j.updated === "number" ? j.updated : updated;
  } catch {
    return null;
  }
}
