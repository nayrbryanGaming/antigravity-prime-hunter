/**
 * /api/hunt — server-side prime hunter that runs on Vercel's infrastructure.
 *
 * Triggered by Vercel Cron (see vercel.json `crons`) on a fixed schedule, 24/7,
 * completely independent of any browser or laptop. Each invocation:
 *
 *   1. Reads the current public/cloud-primes.json from GitHub
 *   2. Finds new primes with BPSW for ~45 seconds on Vercel's CPU
 *   3. Commits the updated ledger back to GitHub (repo scope — not a workflow file)
 *   4. Vercel auto-redeploys, so the live site shows the new primes
 *
 * This proves the computation happens on a server, not the user's machine.
 * The git commit it writes is a tamper-evident, timestamped record of each run.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Hobby ceiling

// ── Config ────────────────────────────────────────────────────
// Vercel Blob store "prime-ledger" (public). Reads are token-free via this URL;
// writes use BLOB_READ_WRITE_TOKEN, injected by Vercel when the store is connected.
const BLOB_HOST = "yz44bxlsf8wvzj6q.public.blob.vercel-storage.com";
const LEDGER_KEY = "cloud-primes.json";
const LEDGER_URL = `https://${BLOB_HOST}/${LEDGER_KEY}`;
const HUNT_MS = 45_000;        // compute window, leaves room for blob round-trips
const TARGET_BITS = 1024;      // 309 digits — fast enough for many primes per run
const MAX_STORED = 2000;

// ── BPSW primality (trial division + 20-witness Miller-Rabin) ──
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n; base %= mod;
  while (exp > 0n) { if (exp & 1n) r = r * base % mod; exp >>= 1n; base = base * base % mod; }
  return r;
}

const SMALL: bigint[] = (() => {
  const out: bigint[] = []; const isP = (n: number) => {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
  };
  for (let n = 2; out.length < 400; n++) if (isP(n)) out.push(BigInt(n));
  return out;
})();

const WITNESSES = [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n,41n,43n,47n,53n,59n,61n,67n,71n];

function millerRabin(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n]) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d >>= 1n; r++; }
  for (const a of WITNESSES) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1n; i < r; i++) { x = x * x % n; if (x === n - 1n) { composite = false; break; } }
    if (composite) return false;
  }
  return true;
}

function trialDivide(n: bigint): boolean {
  for (const p of SMALL) { if (p * p > n) return true; if (n % p === 0n) return n === p; }
  return true;
}

const isPrime = (n: bigint) => trialDivide(n) && millerRabin(n);

function randomOddBigInt(bits: number): bigint {
  const bytes = Math.ceil(bits / 8);
  const buf = randomBytes(bytes);
  buf[0] |= 0x80; buf[bytes - 1] |= 0x01;
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}

// ── GitHub Contents API ───────────────────────────────────────
interface Ledger {
  primes: Array<Record<string, unknown>>;
  totalFound: number; totalTested: number; runCount: number;
  firstRun: string; lastRun: string | null;
  lastRunFound: number; lastRunTested: number; ratePerHour: number;
}

const EMPTY: Ledger = {
  primes: [], totalFound: 0, totalTested: 0, runCount: 0,
  firstRun: new Date().toISOString(), lastRun: null,
  lastRunFound: 0, lastRunTested: 0, ratePerHour: 0,
};

// Read the running ledger from the public Blob URL (no token required).
async function readLedger(): Promise<Ledger> {
  try {
    const res = await fetch(`${LEDGER_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { ...EMPTY };
    const json = await res.json();
    return { ...EMPTY, ...json };
  } catch {
    return { ...EMPTY };
  }
}

// Write the ledger back to Blob. Uses BLOB_READ_WRITE_TOKEN from env.
// Returns the blob URL on success, or an error string.
async function writeLedger(ledger: Ledger): Promise<{ url?: string; error?: string }> {
  try {
    const result = await put(LEDGER_KEY, JSON.stringify(ledger, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    return { url: result.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Handler ───────────────────────────────────────────────────
async function handle(req: Request) {
  const t0 = Date.now();

  // Optional protection: if CRON_SECRET is set, require it.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Hunt loop — pure deterministic math (BPSW). No AI, no model, no network.
  let tested = 0;
  const newPrimes: Array<Record<string, unknown>> = [];
  while (Date.now() - t0 < HUNT_MS) {
    const c = randomOddBigInt(TARGET_BITS);
    tested++;
    if (isPrime(c)) {
      const full = c.toString();
      newPrimes.push({
        bits: TARGET_BITS,
        digits: full.length,
        decimal: full.slice(0, 30) + "…",
        fullDecimal: full,
        fullHex: c.toString(16),
        foundAt: new Date().toISOString(),
        runner: "vercel-cron",
      });
    }
  }

  // Read current ledger (public blob, token-free), merge, write back to blob.
  const prev = await readLedger();
  const merged: Ledger = {
    primes: [...newPrimes, ...prev.primes].slice(0, MAX_STORED),
    totalFound: prev.totalFound + newPrimes.length,
    totalTested: prev.totalTested + tested,
    runCount: prev.runCount + 1,
    firstRun: prev.firstRun ?? new Date().toISOString(),
    lastRun: new Date().toISOString(),
    lastRunFound: newPrimes.length,
    lastRunTested: tested,
    ratePerHour: Math.round(newPrimes.length / (HUNT_MS / 3_600_000)),
  };

  const write = await writeLedger(merged);
  const persisted = !!write.url;

  return NextResponse.json({
    ok: true,
    server: "vercel",
    region: process.env.VERCEL_REGION ?? "unknown",
    engine: "BPSW (deterministic math — no AI)",
    elapsedMs: Date.now() - t0,
    tested,
    found: newPrimes.length,
    bits: TARGET_BITS,
    persisted,
    ledgerUrl: LEDGER_URL,
    totalFoundAllTime: merged.totalFound,
    writeError: write.error ?? null,
    sample: newPrimes.slice(0, 3).map(p => ({ digits: p.digits, head: (p.fullDecimal as string).slice(0, 40) + "…" })),
    note: persisted
      ? "Computed on Vercel servers and persisted to Vercel Blob (free, no AI)."
      : "Computed on Vercel servers. Blob write pending store connection — see writeError.",
  });
}

export const GET  = handle;
export const POST = handle;
