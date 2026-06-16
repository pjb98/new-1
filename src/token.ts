/**
 * Client side of the real-token earning rails. INTENTIONALLY THIN.
 *
 * TRUST MODEL (do not "optimize" this away):
 *  - This is a static, fully inspectable client. It can NEVER be the authority
 *    on how many tokens a player earned — anyone can edit localStorage / the JS.
 *  - So the client only does two things: (1) ASK the backend what's claimable
 *    for a wallet, and (2) forward a wallet-signed claim REQUEST. The backend
 *    (token-backend/) verifies the signature, consults its own ledger, and is
 *    the only thing that ever signs a treasury transfer.
 *  - Until a backend URL is configured + deployed, claiming is simply disabled
 *    and we say so honestly rather than fake a payout.
 */

const LS_KEY = "tinydead.tokenapi";

function readInit(): string {
  try {
    return localStorage.getItem(LS_KEY) ?? "";
  } catch {
    return "";
  }
}

let apiUrl = readInit();

/** Configured reward-backend base URL (empty string = not set up yet). */
export function getTokenApiUrl(): string {
  return apiUrl;
}

/** Point the client at a deployed token-backend. Returns the normalized URL. */
export function setTokenApiUrl(input: string): string {
  apiUrl = (input || "").trim().replace(/\/+$/, "");
  try {
    localStorage.setItem(LS_KEY, apiUrl);
  } catch {
    /* storage unavailable — session only */
  }
  return apiUrl;
}

/**
 * Server-authoritative claimable balance for a wallet. Returns null when no
 * backend is configured or it's unreachable (so the UI can stay honest).
 */
export async function fetchClaimable(address: string): Promise<number | null> {
  if (!apiUrl) return null;
  try {
    const r = await fetch(`${apiUrl}/claimable?address=${encodeURIComponent(address)}`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { claimable?: unknown };
    return typeof j.claimable === "number" && Number.isFinite(j.claimable) ? j.claimable : null;
  } catch {
    return null;
  }
}

/**
 * Earn rails — convert gameplay gold into claimable $TINY via the backend.
 *
 * Sign ONCE per session for a short-lived token (so reporting after each run
 * doesn't pop a wallet signature every time); the backend then caps/credits.
 * All no-ops until a backend URL is configured.
 */

/** Sign in for an earn-session token. `sign` returns a base64 signature (or null
 *  if declined). Returns the token, or null on any failure. */
export async function earnLogin(
  address: string,
  sign: (message: string) => Promise<string | null>,
): Promise<string | null> {
  if (!apiUrl) return null;
  try {
    const message = `Tiny Realm login\naddress: ${address}\nts: ${Date.now()}`;
    const signature = await sign(message);
    if (!signature) return null;
    const r = await fetch(`${apiUrl}/earn/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, message, signature }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { token?: unknown };
    return typeof j.token === "string" ? j.token : null;
  } catch {
    return null;
  }
}

/** Report gameplay gold for crediting (server caps it). Returns the $TINY
 *  credited, null on failure, or "expired" if the session token is stale. */
export async function reportEarn(token: string, gold: number): Promise<number | "expired" | null> {
  if (!apiUrl || !(gold > 0)) return null;
  try {
    const r = await fetch(`${apiUrl}/earn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, gold: Math.floor(gold) }),
    });
    if (r.status === 401) return "expired";
    if (!r.ok) return null;
    const j = (await r.json()) as { credited?: unknown };
    return typeof j.credited === "number" ? j.credited : null;
  } catch {
    return null;
  }
}

/** base64-encode raw signature bytes for JSON transport (no deps). */
export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
