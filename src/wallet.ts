/**
 * Lightweight Solana wallet connector — NO npm dependencies. Talks to the
 * wallet's injected provider (Phantom / Solflare / Backpack) via `window.solana`.
 *
 * SECURITY MODEL (read before extending):
 *  - The client NEVER holds private keys and NEVER moves funds. Connecting only
 *    reveals the user's public address + lets them SIGN a login message.
 *  - "Claiming" earned rewards must be authorized by a TRUSTED BACKEND that
 *    independently verifies the run (see requestClaim — it only *asks*; it does
 *    not pay). A static client cannot safely pay anyone (it's inspectable JS).
 *  - Token "balance" shown here is read-only display from a public RPC.
 */

import { getTokenApiUrl, bytesToB64 } from "./token";

export interface WalletState {
  connected: boolean;
  address: string | null;
  /** Display balance of the game token (or null until fetched). */
  tokenBalance: number | null;
}

type Provider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  signMessage?: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array }>;
  on?: (event: string, cb: (...a: any[]) => void) => void;
};

function getProvider(): Provider | null {
  const w = window as any;
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana as Provider;
  if (w.solana) return w.solana as Provider;
  return null;
}

/** Wallet extensions/in-app browsers can inject `window.solana` a beat after the
 *  page loads (esp. Phantom's mobile in-app browser), so poll briefly. */
function waitForProvider(timeoutMs = 1800): Promise<Provider | null> {
  const now = getProvider();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      const p = getProvider();
      if (p || Date.now() - start > timeoutMs) { clearInterval(t); resolve(p); }
    }, 100);
  });
}

export class Wallet {
  state: WalletState = { connected: false, address: null, tokenBalance: null };
  onChange?: (s: WalletState) => void;

  get available(): boolean {
    return getProvider() !== null;
  }

  /** Short display form: "AbCd…WxYz". */
  get short(): string {
    const a = this.state.address;
    return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
  }

  /** Try to reconnect silently if the user trusted us before. */
  async tryEagerConnect() {
    const p = getProvider();
    if (!p) return;
    try {
      const res = await p.connect({ onlyIfTrusted: true });
      this.applyConnected(res.publicKey.toString());
      p.on?.("disconnect", () => this.applyDisconnected());
      p.on?.("accountChanged", (pk: any) => {
        if (pk) this.applyConnected(pk.toString());
        else this.applyDisconnected();
      });
    } catch {
      /* not previously trusted — stay disconnected */
    }
  }

  /** Explicit connect (opens the wallet popup). Returns the address or null. */
  async connect(): Promise<string | null> {
    const p = await waitForProvider();
    if (!p) {
      // No injected wallet (e.g. a plain mobile browser). Send them to Phantom;
      // caller surfaces a "no wallet" message either way.
      try { window.open("https://phantom.app/", "_blank", "noopener"); } catch { /* ignore */ }
      return null;
    }
    try {
      const res = await p.connect();
      const addr = res.publicKey.toString();
      this.applyConnected(addr);
      p.on?.("disconnect", () => this.applyDisconnected());
      return addr;
    } catch {
      return null; // user rejected
    }
  }

  async disconnect() {
    try {
      await getProvider()?.disconnect();
    } catch {
      /* ignore */
    }
    this.applyDisconnected();
  }

  private applyConnected(address: string) {
    this.state = { connected: true, address, tokenBalance: this.state.tokenBalance };
    this.onChange?.(this.state);
  }
  private applyDisconnected() {
    this.state = { connected: false, address: null, tokenBalance: null };
    this.onChange?.(this.state);
  }

  /**
   * Sign an arbitrary UTF-8 message with the connected wallet and return the
   * base64 signature (or null if there's no provider, it can't sign, or the
   * user declines). Used by cloud-save login to prove wallet ownership — no
   * funds ever move. Same signing path as requestClaim, factored for reuse.
   */
  async signText(text: string): Promise<string | null> {
    const p = getProvider();
    if (!p?.signMessage) return null;
    try {
      const { signature } = await p.signMessage(new TextEncoder().encode(text), "utf8");
      return bytesToB64(signature);
    } catch {
      return null; // user declined or signing failed
    }
  }

  /**
   * Request a payout of earned rewards. The client NEVER moves funds and never
   * tells the server an amount — it only proves wallet ownership (a signed
   * message) and asks. The backend verifies the signature, reads ITS OWN ledger
   * to decide what (if anything) is owed, and signs the treasury transfer.
   * Returns a human-readable status for the UI.
   */
  async requestClaim(): Promise<{ ok: boolean; message: string }> {
    if (!this.state.connected || !this.state.address) {
      return { ok: false, message: "Connect a wallet first" };
    }
    const api = getTokenApiUrl();
    if (!api) {
      return { ok: false, message: "Set your token backend (⚙) — claiming goes live once it's deployed." };
    }
    const p = getProvider();
    if (!p?.signMessage) {
      return { ok: false, message: "This wallet can't sign messages — try Phantom." };
    }
    try {
      // Sign a fresh, timestamped intent so the backend can verify ownership
      // and reject replays. The server decides the amount, not us.
      const message = `Tiny Dead — claim earnings\naddress: ${this.state.address}\nts: ${Date.now()}`;
      const { signature } = await p.signMessage(new TextEncoder().encode(message), "utf8");
      const res = await fetch(`${api}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ address: this.state.address, message, signature: bytesToB64(signature) }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; txid?: string; claimed?: number };
      if (!res.ok || !j.ok) {
        return { ok: false, message: j.error || "Claim rejected by the server." };
      }
      const amt = typeof j.claimed === "number" ? `${j.claimed} $TINY` : "earnings";
      const tx = j.txid ? ` (tx ${String(j.txid).slice(0, 8)}…)` : "";
      return { ok: true, message: `Claimed ${amt}!${tx}` };
    } catch {
      return { ok: false, message: "Claim failed — backend unreachable or signature declined." };
    }
  }
}
