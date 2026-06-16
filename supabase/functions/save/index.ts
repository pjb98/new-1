/**
 * Tiny Dead wallet CLOUD-SAVE — Supabase Edge Function (Deno).
 *
 * A single endpoint handling two JSON POST actions: "login" and "push".
 *
 * TRUST MODEL (same as the old PartyKit save party): the client proves wallet
 * ownership by signing a timestamped message with its Solana (ed25519) key. This
 * function verifies that signature, then — and only then — writes using the
 * SERVICE-ROLE key, which bypasses RLS. Both tables have RLS enabled with NO
 * policies, so no client (anon/auth) can ever read or write them directly; every
 * mutation flows through this verified path. The client therefore cannot forge
 * saves for an address it doesn't control.
 *
 * Auth split:
 *   - login: full wallet-signature verification, mints a 6h session token.
 *   - push:  cheaper bearer-style token check (token must exist, be unexpired,
 *            and belong to the same address). Avoids re-signing on every push.
 *
 * verify_jwt is DISABLED for this function (see config.toml): it authenticates
 * callers itself, so the static game client can invoke it without a Supabase JWT
 * or anon key.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import bs58 from "https://esm.sh/bs58@5.0.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---- constants ----
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // session token lifetime: 6 hours
const TS_SKEW_MS = 300_000; // ±5 min allowed clock skew on the login timestamp
const MAX_BODY_BYTES = 256 * 1024; // 256 KB cap on the serialized save blob

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** Canonical login message — must match the client's saveSignText byte-for-byte. */
function expectedMessage(address: string, ts: number): string {
  return `Tiny Dead save sync\naddress: ${address}\nts: ${ts}`;
}

const enc = new TextEncoder();

/** Decode a standard base64 string to bytes (Deno has atob). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mint a URL-safe (base64url) token from 32 random bytes. */
function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** timestamptz string -> epoch ms (0 if missing/unparseable). */
function toMs(ts: unknown): number {
  if (typeof ts !== "string") return 0;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

// ---- actions ----

async function handleLogin(body: Record<string, unknown>): Promise<Response> {
  const address = body.address;
  const message = body.message;
  const signature = body.signature;
  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string") {
    return json({ ok: false, error: "bad request" }, 401);
  }

  // Message must match the canonical format exactly, with a fresh timestamp.
  const prefix = `Tiny Dead save sync\naddress: ${address}\nts: `;
  if (!message.startsWith(prefix)) {
    return json({ ok: false, error: "bad message" }, 401);
  }
  const tsStr = message.slice(prefix.length);
  if (!/^\d+$/.test(tsStr)) {
    return json({ ok: false, error: "bad ts" }, 401);
  }
  const ts = Number(tsStr);
  if (message !== expectedMessage(address, ts)) {
    return json({ ok: false, error: "bad message" }, 401);
  }
  if (Math.abs(Date.now() - ts) > TS_SKEW_MS) {
    return json({ ok: false, error: "stale" }, 401);
  }

  // Verify the ed25519 signature against the wallet's public key (the address).
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      enc.encode(message),
      base64ToBytes(signature),
      bs58.decode(address),
    );
  } catch {
    ok = false;
  }
  if (!ok) {
    return json({ ok: false, error: "bad signature" }, 401);
  }

  // Opportunistic cleanup of expired tokens (keeps the table small).
  await supabase.from("save_tokens").delete().lt("expires", new Date().toISOString());

  // Mint and store a fresh 6h session token.
  const token = mintToken();
  const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const ins = await supabase.from("save_tokens").insert({ token, address, expires });
  if (ins.error) {
    return json({ ok: false, error: "token error" }, 500);
  }

  // Return the stored save (if any) for this address.
  const row = await supabase.from("saves").select("blob, updated").eq("address", address).maybeSingle();
  if (row.error) {
    return json({ ok: false, error: "read error" }, 500);
  }
  return json({
    ok: true,
    token,
    save: row.data ? row.data.blob : null,
    updated: row.data ? toMs(row.data.updated) : 0,
  });
}

async function handlePush(body: Record<string, unknown>): Promise<Response> {
  const address = body.address;
  const token = body.token;
  const save = body.save;
  const updated = body.updated;
  if (typeof address !== "string" || typeof token !== "string") {
    return json({ ok: false, error: "bad request" }, 401);
  }

  // Validate the session token: must exist, be unexpired, and match the address.
  const tok = await supabase
    .from("save_tokens")
    .select("address, expires")
    .eq("token", token)
    .maybeSingle();
  if (tok.error) {
    return json({ ok: false, error: "token error" }, 500);
  }
  const valid =
    tok.data && tok.data.address === address && toMs(tok.data.expires) > Date.now();
  if (!valid) {
    // Drop the offending token (if present) and reject.
    await supabase.from("save_tokens").delete().eq("token", token);
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // The save must be a plain object and fit within the size cap.
  if (!isPlainObject(save)) {
    return json({ ok: false, error: "bad save" }, 400);
  }
  const serialized = JSON.stringify(save);
  if (enc.encode(serialized).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "too large" }, 413);
  }
  // `updated` is accepted but the server timestamp is authoritative.
  void updated;

  const now = new Date().toISOString();
  const up = await supabase
    .from("saves")
    .upsert({ address, blob: save, updated: now }, { onConflict: "address" });
  if (up.error) {
    return json({ ok: false, error: "write error" }, 500);
  }
  return json({ ok: true, updated: Date.parse(now) });
}

// ---- entry ----

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "bad json" }, 400);
    }
    switch (body.action) {
      case "login":
        return await handleLogin(body);
      case "push":
        return await handlePush(body);
      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  } catch (_e) {
    return json({ ok: false, error: "server error" }, 500);
  }
});
