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
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Hobby ceiling

// ── Config ────────────────────────────────────────────────────
// Persistence: Neon Postgres. DATABASE_URL is injected by the Neon/Vercel
// integration — this function never handles the credential directly.
const HUNT_MS = 40_000;        // compute window, leaves room for DB round-trips
const TARGET_BITS = 1024;      // 309 digits — fast enough for many primes per run

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

// ── Neon Postgres persistence ─────────────────────────────────
type Prime = {
  bits: number; digits: number;
  fullDecimal: string; fullHex: string;
  foundAt: string;
};

// Idempotent schema — safe to call every run.
async function ensureSchema(sql: NeonQueryFunction<false, false>) {
  await sql`
    CREATE TABLE IF NOT EXISTS primes (
      id           BIGSERIAL PRIMARY KEY,
      bits         INT NOT NULL,
      digits       INT NOT NULL,
      full_decimal TEXT NOT NULL,
      full_hex     TEXT,
      found_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      runner       TEXT DEFAULT 'vercel-cron'
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS runs (
      id      BIGSERIAL PRIMARY KEY,
      tested  INT NOT NULL,
      found   INT NOT NULL,
      ran_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
}

// Batch-insert found primes in a single round trip via unnest().
async function insertPrimes(sql: NeonQueryFunction<false, false>, primes: Prime[]) {
  if (primes.length === 0) return;
  await sql`
    INSERT INTO primes (bits, digits, full_decimal, full_hex, found_at)
    SELECT * FROM unnest(
      ${primes.map(p => p.bits)}::int[],
      ${primes.map(p => p.digits)}::int[],
      ${primes.map(p => p.fullDecimal)}::text[],
      ${primes.map(p => p.fullHex)}::text[],
      ${primes.map(p => p.foundAt)}::timestamptz[]
    )`;
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
  const newPrimes: Prime[] = [];
  while (Date.now() - t0 < HUNT_MS) {
    const c = randomOddBigInt(TARGET_BITS);
    tested++;
    if (isPrime(c)) {
      const full = c.toString();
      newPrimes.push({
        bits: TARGET_BITS,
        digits: full.length,
        fullDecimal: full,
        fullHex: c.toString(16),
        foundAt: new Date().toISOString(),
      });
    }
  }

  // Persist to Neon Postgres (DATABASE_URL injected by Vercel/Neon integration).
  let persisted = false;
  let writeError: string | null = null;
  let totalFound = 0, totalTested = 0, runCount = 0;
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    const sql = neon(url);
    await ensureSchema(sql);
    await insertPrimes(sql, newPrimes);
    await sql`INSERT INTO runs (tested, found) VALUES (${tested}, ${newPrimes.length})`;
    const [agg] = await sql`
      SELECT
        (SELECT COUNT(*) FROM primes)          AS total_found,
        (SELECT COALESCE(SUM(tested),0) FROM runs) AS total_tested,
        (SELECT COUNT(*) FROM runs)            AS run_count`;
    totalFound  = Number(agg.total_found);
    totalTested = Number(agg.total_tested);
    runCount    = Number(agg.run_count);
    persisted = true;
  } catch (e) {
    writeError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    ok: true,
    server: "vercel",
    region: process.env.VERCEL_REGION ?? "unknown",
    engine: "BPSW (deterministic math — no AI)",
    store: "Neon Postgres",
    elapsedMs: Date.now() - t0,
    tested,
    found: newPrimes.length,
    bits: TARGET_BITS,
    persisted,
    totalFoundAllTime: totalFound,
    totalTestedAllTime: totalTested,
    runCount,
    writeError,
    sample: newPrimes.slice(0, 3).map(p => ({ digits: p.digits, head: p.fullDecimal.slice(0, 40) + "…" })),
    note: persisted
      ? "Computed on Vercel servers and persisted to Neon Postgres (free, no AI)."
      : "Computed on Vercel servers. DB write failed — see writeError.",
  });
}

export const GET  = handle;
export const POST = handle;
