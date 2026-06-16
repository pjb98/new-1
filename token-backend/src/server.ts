/**
 * Tiny Dead — token reward backend (REFERENCE SKELETON).
 *
 * The trusted authority the static game client cannot be. It owns the $TOKEN
 * ledger + treasury and is the ONLY thing that signs payouts. The client can
 * only read balances and forward a wallet-signed claim; it never mints value.
 *
 * ECONOMY (see /ECONOMY.md): Pump.fun trading fees (+ box sales) fund the
 * TREASURY. The treasury buys items from players (buyback) and relists them;
 * players also sell to each other on the marketplace with a 5% fee back to the
 * treasury. Players withdraw their in-game balance to their wallet via /claim.
 *
 * STILL STUBBED for production (see README): real DB (this uses a JSON file),
 * on-chain buyer funding, anti-Sybil / wash-trade checks, withdrawal limits,
 * hot/cold treasury split, VRF for high-value boxes.
 */
import express from "express";
import cors from "cors";
import nacl from "tweetnacl";
import bs58 from "bs58";
import fs from "fs";
import crypto from "crypto";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";

// ---- config (from env) ----------------------------------------------------
const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ""; // protects admin routes
const RPC_URL = process.env.SOLANA_RPC ?? clusterApiUrl("devnet");
const TOKEN_MINT = process.env.TOKEN_MINT ?? ""; // SPL mint of $TOKEN
const TREASURY_SECRET = process.env.TREASURY_SECRET ?? ""; // base58 secret key
const CLAIM_MAX_AGE_MS = 2 * 60 * 1000; // signed claim intents expire after 2 min
const MARKET_FEE = Number(process.env.MARKET_FEE ?? 0.05); // 5% to treasury
const STATE_PATH = process.env.STATE_PATH ?? "./ledger.json";
const TREASURY_SELLER = "TREASURY"; // sentinel: a listing owned by the treasury

// ---- earn config (gameplay → claimable $TINY) -----------------------------
// The static client is forgeable, so these CAPS — not trust — bound the payout:
// a wallet can only convert so much gold/day, throttled, replay-safe. Tune for
// your treasury (funded by coin trading fees). All overridable via env.
const EARN_RATE = Number(process.env.EARN_RATE ?? 0.01);            // $TINY credited per 1 gold earned
const EARN_PER_REQUEST_MAX = Number(process.env.EARN_PER_REQUEST_MAX ?? 50); // cap per single report
const EARN_DAILY_MAX = Number(process.env.EARN_DAILY_MAX ?? 200);  // cap per wallet per UTC day
const EARN_MIN_INTERVAL_MS = Number(process.env.EARN_MIN_INTERVAL_MS ?? 15000); // throttle between reports
const EARN_TOKEN_TTL_MS = Number(process.env.EARN_TOKEN_TTL_MS ?? 6 * 60 * 60 * 1000); // session token life
const utcDay = () => Math.floor(Date.now() / 86_400_000);

// ---- state (JSON-file placeholder — REPLACE WITH A REAL DB) ----------------
interface Account {
  balance: number; // in-game $TOKEN the player holds (spendable + withdrawable)
  claimedTotal: number; // lifetime withdrawn to wallet
  usedSignatures: string[]; // claim replay guard
  lastEarnTs?: number; // last accepted /earn (rate-limit)
  earnDay?: number; // UTC day-index the daily earn window belongs to
  earnedToday?: number; // $TINY credited via /earn so far today (vs EARN_DAILY_MAX)
}
interface Listing {
  id: number;
  seller: string; // wallet address, or TREASURY_SELLER
  item: string;
  rarity: string;
  price: number;
}
interface State {
  accounts: Record<string, Account>;
  treasury: number; // $TOKEN held by the treasury (fees + box sales fund this)
  market: Listing[];
  nextListingId: number;
  /** Player housing keyed by "owner:plotIndex" → house layout JSON. */
  houses: Record<string, unknown>;
  /** Social counters keyed by "owner:plotIndex" → likes/visits. */
  houseSocial?: Record<string, { likes: number; visits: number }>;
  /** Short-lived earn-session tokens: token → { address, exp }. */
  tokens?: Record<string, { address: string; exp: number }>;
}

function load(): State {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as Partial<State>;
    return {
      accounts: s.accounts ?? {},
      treasury: s.treasury ?? 0,
      market: s.market ?? [],
      nextListingId: s.nextListingId ?? 1,
      houses: s.houses ?? {},
      houseSocial: s.houseSocial ?? {},
      tokens: s.tokens ?? {},
    };
  } catch {
    return { accounts: {}, treasury: 0, market: [], nextListingId: 1, houses: {}, houseSocial: {}, tokens: {} };
  }
}
function save(s: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
function acct(s: State, addr: string): Account {
  return (s.accounts[addr] ??= { balance: 0, claimedTotal: 0, usedSignatures: [] });
}
const round = (n: number) => Math.round(n * 1e6) / 1e6; // tame float drift

// ---- helpers --------------------------------------------------------------
function isAdmin(req: express.Request): boolean {
  return !!ADMIN_SECRET && req.headers["x-admin-secret"] === ADMIN_SECRET;
}

function treasuryKeypair(): Keypair | null {
  return TREASURY_SECRET ? Keypair.fromSecretKey(bs58.decode(TREASURY_SECRET)) : null;
}

/** Send `amount` whole tokens of $TOKEN from treasury to `toOwner`. */
async function payout(toOwner: string, amount: number): Promise<string> {
  const signer = treasuryKeypair();
  if (!signer || !TOKEN_MINT) return "DRYRUN-" + crypto.randomBytes(8).toString("hex");
  const conn = new Connection(RPC_URL, "confirmed");
  const mint = new PublicKey(TOKEN_MINT);
  const from = await getOrCreateAssociatedTokenAccount(conn, signer, mint, signer.publicKey);
  const to = await getOrCreateAssociatedTokenAccount(conn, signer, mint, new PublicKey(toOwner));
  // NOTE: assumes 0 decimals for clarity — use the mint's real decimals in prod.
  return transfer(conn, signer, from.address, to.address, signer, amount);
}

/** True if `signature` (base64) over `message` was made by `address` (base58). */
function verifySig(address: string, message: string, signatureB64: string): boolean {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      Buffer.from(signatureB64, "base64"),
      bs58.decode(address),
    );
  } catch {
    return false;
  }
}
function freshTimestamp(message: string): boolean {
  const m = message.match(/ts:\s*(\d+)/);
  if (!m) return false;
  const age = Date.now() - Number(m[1]);
  return age >= 0 && age < CLAIM_MAX_AGE_MS;
}

// ---- app ------------------------------------------------------------------
const app = express();
app.use(cors()); // TODO: restrict to your game origin in production
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// --- treasury ---
app.get("/treasury", (_req, res) => {
  const s = load();
  res.json({ treasury: s.treasury, listings: s.market.length });
});

/** Record fees arriving (Pump.fun creator fees, box/cosmetic sales). Admin. */
app.post("/treasury/deposit", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  const { amount } = req.body ?? {};
  if (typeof amount !== "number" || !(amount > 0)) return res.status(400).json({ error: "positive amount required" });
  const s = load();
  s.treasury = round(s.treasury + amount);
  save(s);
  res.json({ ok: true, treasury: s.treasury });
});

// --- balances ---
app.get("/balance", (req, res) => {
  const s = load();
  res.json({ balance: acct(s, String(req.query.address ?? "")).balance });
});
// client (src/token.ts) reads `claimable`; it's the same withdrawable balance
app.get("/claimable", (req, res) => {
  const s = load();
  res.json({ claimable: acct(s, String(req.query.address ?? "")).balance });
});

/** Grant rewards to a player's balance (prize pools / events). Admin. */
app.post("/credit", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  const { address, amount } = req.body ?? {};
  if (typeof address !== "string" || typeof amount !== "number" || !(amount > 0)) {
    return res.status(400).json({ error: "address + positive amount required" });
  }
  const s = load();
  acct(s, address).balance = round(acct(s, address).balance + amount);
  save(s);
  res.json({ ok: true, balance: s.accounts[address].balance });
});

// --- marketplace ---
app.get("/market", (_req, res) => {
  res.json({ listings: load().market });
});

/** A player lists an item for $TOKEN. (Item ownership is trusted here; in prod
 *  the server-authoritative inventory must confirm the seller owns it.) */
app.post("/market/list", (req, res) => {
  const { address, item, rarity, price } = req.body ?? {};
  if (typeof address !== "string" || typeof item !== "string" || typeof price !== "number" || !(price > 0)) {
    return res.status(400).json({ error: "address + item + positive price required" });
  }
  const s = load();
  const listing: Listing = { id: s.nextListingId++, seller: address, item, rarity: String(rarity ?? "common"), price: round(price) };
  s.market.push(listing);
  save(s);
  res.json({ ok: true, listing });
});

/** Buy a listing. Buyer pays from balance; 5% fee → treasury; rest → seller
 *  (or all → treasury if the treasury was the seller, i.e. a relisted buyback). */
app.post("/market/buy", (req, res) => {
  const { address, id } = req.body ?? {};
  if (typeof address !== "string" || typeof id !== "number") {
    return res.status(400).json({ error: "address + listing id required" });
  }
  const s = load();
  const idx = s.market.findIndex((l) => l.id === id);
  if (idx < 0) return res.status(404).json({ error: "listing not found" });
  const listing = s.market[idx];
  if (listing.seller === address) return res.status(400).json({ error: "can't buy your own listing" });
  const buyer = acct(s, address);
  if (buyer.balance < listing.price) return res.status(402).json({ error: "insufficient $TOKEN balance" });

  buyer.balance = round(buyer.balance - listing.price);
  const fee = round(listing.price * MARKET_FEE);
  if (listing.seller === TREASURY_SELLER) {
    s.treasury = round(s.treasury + listing.price); // treasury reselling its own buyback
  } else {
    acct(s, listing.seller).balance = round(acct(s, listing.seller).balance + (listing.price - fee));
    s.treasury = round(s.treasury + fee);
  }
  s.market.splice(idx, 1);
  save(s);
  res.json({ ok: true, item: listing.item, paid: listing.price, fee, buyerBalance: buyer.balance });
});

/** Treasury buys an item from a player (liquidity floor) and relists it. Admin
 *  — your game logic calls this when a player hits "instant sell". */
app.post("/buyback", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  const { address, item, rarity, price } = req.body ?? {};
  if (typeof address !== "string" || typeof item !== "string" || typeof price !== "number" || !(price > 0)) {
    return res.status(400).json({ error: "address + item + positive price required" });
  }
  const s = load();
  if (s.treasury < price) return res.status(409).json({ error: "treasury underfunded" });
  s.treasury = round(s.treasury - price);
  acct(s, address).balance = round(acct(s, address).balance + price);
  // relist at a markup so the treasury recovers when another player buys it
  const listing: Listing = { id: s.nextListingId++, seller: TREASURY_SELLER, item, rarity: String(rarity ?? "common"), price: round(price * 1.25) };
  s.market.push(listing);
  save(s);
  res.json({ ok: true, paid: price, balance: s.accounts[address].balance, relisted: listing });
});

/** Provably-fair mystery-box open (commit-reveal). Admin/authenticated only. */
app.post("/box/open", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  const { serverSeed, clientSeed, nonce } = req.body ?? {};
  if (!serverSeed || !clientSeed) return res.status(400).json({ error: "seeds required" });
  const roll = crypto.createHmac("sha256", String(serverSeed)).update(`${clientSeed}:${nonce ?? 0}`).digest();
  const p = roll.readUInt32BE(0) / 0xffffffff; // 0..1, verifiable after reveal
  const tier = p < 0.005 ? "mythic" : p < 0.05 ? "legendary" : p < 0.2 ? "epic" : p < 0.5 ? "rare" : "common";
  res.json({ ok: true, tier, p, commit: crypto.createHash("sha256").update(String(serverSeed)).digest("hex") });
});

// --- housing (island plots) ---
const HOUSE_PART_KINDS = new Set([
  "wall", "floor", "roof", "door", "window", "fence", "tree", "lamp", "flower",
  "bed", "table", "chair", "rug", "lamppost", "bush", "path",
  "banner", "statue", "perch", "trophy",
]);

/** Validate + clamp a house blob server-side (open/cosmetic, but bounded). */
function sanitizeHousePayload(house: unknown): { parts: Record<string, unknown>[] } | null {
  const parts = (house as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return null;
  const out: Record<string, unknown>[] = [];
  for (const p of parts) {
    if (out.length >= 400) break;
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.kind !== "string" || !HOUSE_PART_KINDS.has(o.kind)) continue;
    const gx = Number(o.gx), gy = Number(o.gy), gz = Number(o.gz);
    if (![gx, gy, gz].every(Number.isFinite)) continue;
    if (Math.abs(gx) > 2 || Math.abs(gz) > 2 || gy < 0 || gy > 4) continue;
    const part: Record<string, unknown> = { kind: o.kind, gx, gy, gz };
    if (typeof o.color === "number") part.color = o.color;
    const rot = Number(o.rot);
    if (Number.isFinite(rot) && rot !== 0) part.rot = (((rot % 4) + 4) % 4);
    if (o.kind === "perch" && typeof o.petId === "string" && o.petId.length <= 40) part.petId = o.petId;
    const tier = Number(o.tier);
    if (o.kind === "trophy" && Number.isFinite(tier)) part.tier = Math.min(3, Math.max(0, Math.floor(tier)));
    out.push(part);
  }
  return { parts: out };
}

const houseSocialFor = (s: State, key: string) =>
  ((s.houseSocial ??= {})[key] ??= { likes: 0, visits: 0 });

app.get("/house", (req, res) => {
  const owner = String(req.query.owner ?? "");
  const plot = String(req.query.plot ?? "");
  if (!owner || plot === "") return res.status(400).json({ error: "owner + plot required" });
  const s = load();
  const key = `${owner}:${plot}`;
  const house = s.houses[key] ?? null;
  const social = houseSocialFor(s, key);
  // A GET with ?visit=1 counts as a visit (only when there's a house to see).
  if (house && req.query.visit === "1") {
    social.visits += 1;
    save(s);
  }
  res.json({ house, likes: social.likes, visits: social.visits });
});

/** Save a plot's house layout. Open by design (it's cosmetic, no value); add
 *  wallet-signature auth here if you want to lock plots to their owner. */
app.post("/house", (req, res) => {
  const { owner, plot, house } = req.body ?? {};
  if (typeof owner !== "string" || (typeof plot !== "number" && typeof plot !== "string")) {
    return res.status(400).json({ error: "owner + plot required" });
  }
  const clean = sanitizeHousePayload(house);
  if (!clean) return res.status(400).json({ error: "invalid house (parts array, max 400)" });
  const s = load();
  s.houses[`${owner}:${plot}`] = clean;
  save(s);
  res.json({ ok: true });
});

/** Like a house. Open/cosmetic; one POST = +1 like.
 *  NOTE (skeleton): no per-caller dedupe/rate-limit — likes (and visits via
 *  GET ?visit=1) can be inflated by a script. Fine while purely cosmetic; gate
 *  behind a per-wallet like-set + rate limit before they carry any weight. */
app.post("/house/like", (req, res) => {
  const { owner, plot } = req.body ?? {};
  if (typeof owner !== "string" || (typeof plot !== "number" && typeof plot !== "string")) {
    return res.status(400).json({ error: "owner + plot required" });
  }
  const s = load();
  const key = `${owner}:${plot}`;
  if (!s.houses[key]) return res.status(404).json({ error: "no house" });
  const social = houseSocialFor(s, key);
  social.likes += 1;
  save(s);
  res.json({ ok: true, likes: social.likes });
});

// --- earn (gameplay → claimable $TINY) ---

/** Sign once per session to get a short-lived earn token, so reporting earnings
 *  after each run doesn't pop a wallet signature every time. The signature proves
 *  wallet ownership; the token authorizes subsequent /earn calls for ~6h. */
app.post("/earn/login", (req, res) => {
  const { address, message, signature } = req.body ?? {};
  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string") {
    return res.status(400).json({ error: "address, message, signature required" });
  }
  if (!message.includes(`address: ${address}`)) return res.status(400).json({ error: "message/address mismatch" });
  if (!freshTimestamp(message)) return res.status(400).json({ error: "signed request expired — try again" });
  if (!verifySig(address, message, signature)) return res.status(401).json({ error: "bad signature" });
  const s = load();
  const tokens = (s.tokens ??= {});
  const now = Date.now();
  for (const [t, v] of Object.entries(tokens)) if (v.exp <= now) delete tokens[t]; // prune expired
  const token = crypto.randomBytes(24).toString("base64url");
  tokens[token] = { address, exp: now + EARN_TOKEN_TTL_MS };
  save(s);
  res.json({ ok: true, token, ttl: EARN_TOKEN_TTL_MS });
});

/** Convert gameplay gold into claimable $TINY, capped hard. Auth is the earn
 *  token from /earn/login. CAPS are the treasury's protection (client is
 *  forgeable): per-request max, per-wallet daily max, and a rate-limit. */
app.post("/earn", (req, res) => {
  const { token, gold } = req.body ?? {};
  if (typeof token !== "string" || typeof gold !== "number" || !(gold > 0)) {
    return res.status(400).json({ error: "token + positive gold required" });
  }
  const s = load();
  const tok = (s.tokens ??= {})[token];
  const now = Date.now();
  if (!tok || tok.exp <= now) { if (tok) delete s.tokens![token]; save(s); return res.status(401).json({ error: "session expired — sign in again" }); }
  const a = acct(s, tok.address);
  if (a.lastEarnTs && now - a.lastEarnTs < EARN_MIN_INTERVAL_MS) return res.status(429).json({ error: "slow down" });
  // roll the daily window
  const day = utcDay();
  if (a.earnDay !== day) { a.earnDay = day; a.earnedToday = 0; }
  const remaining = Math.max(0, EARN_DAILY_MAX - (a.earnedToday ?? 0));
  const credit = round(Math.min(Math.floor(gold) * EARN_RATE, EARN_PER_REQUEST_MAX, remaining));
  a.lastEarnTs = now;
  if (credit > 0) {
    a.balance = round(a.balance + credit);
    a.earnedToday = round((a.earnedToday ?? 0) + credit);
  }
  save(s);
  res.json({ ok: true, credited: credit, balance: a.balance, dailyRemaining: round(EARN_DAILY_MAX - (a.earnedToday ?? 0)) });
});

/** Withdraw in-game balance to the wallet. Client proves ownership; server
 *  decides the amount from its ledger and signs the treasury transfer. */
app.post("/claim", async (req, res) => {
  const { address, message, signature } = req.body ?? {};
  if (typeof address !== "string" || typeof message !== "string" || typeof signature !== "string") {
    return res.status(400).json({ error: "address, message, signature required" });
  }
  if (!message.includes(`address: ${address}`)) return res.status(400).json({ error: "message/address mismatch" });
  if (!freshTimestamp(message)) return res.status(400).json({ error: "signed request expired — try again" });
  if (!verifySig(address, message, signature)) return res.status(401).json({ error: "bad signature" });

  const s = load();
  const a = acct(s, address);
  if (a.usedSignatures.includes(signature)) return res.status(409).json({ error: "already used" });
  const amount = a.balance;
  if (amount <= 0) return res.json({ ok: false, error: "nothing to claim" });

  // reserve before paying so a crash can't double-pay
  a.usedSignatures.push(signature);
  if (a.usedSignatures.length > 50) a.usedSignatures.shift();
  a.balance = 0;
  a.claimedTotal = round(a.claimedTotal + amount);
  save(s);

  try {
    const txid = await payout(address, amount);
    res.json({ ok: true, claimed: amount, txid });
  } catch (e) {
    a.balance = round(a.balance + amount); // refund on failure
    a.claimedTotal = round(a.claimedTotal - amount);
    save(s);
    res.status(502).json({ error: "payout failed: " + (e as Error).message });
  }
});

app.listen(PORT, () => console.log(`token-backend on :${PORT} (rpc=${RPC_URL}, fee=${MARKET_FEE})`));
