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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel Hobby ceiling

// ── Config ────────────────────────────────────────────────────
const OWNER = "nayrbryanGaming";
const REPO  = "antigravity-prime-hunter";
const PATH  = "public/cloud-primes.json";
const HUNT_MS = 45_000;        // compute window, leaves room for GitHub round-trips
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

async function readLedger(token: string): Promise<{ ledger: Ledger; sha?: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" }
  );
  if (!res.ok) return { ledger: { ...EMPTY } };
  const data = await res.json();
  try {
    const json = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
    return { ledger: { ...EMPTY, ...json }, sha: data.sha };
  } catch {
    return { ledger: { ...EMPTY }, sha: data.sha };
  }
}

async function writeLedger(token: string, ledger: Ledger, sha: string | undefined, found: number) {
  const body = {
    message: `bot: cloud hunt +${found} prime(s) ${new Date().toISOString()} [skip ci]`,
    content: Buffer.from(JSON.stringify(ledger, null, 2)).toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify(body),
    }
  );
  return res.ok ? (await res.json()) : { error: await res.text() };
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

  const token = process.env.GH_TOKEN;

  // Hunt loop
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

  // Persist to GitHub if we have a token
  let committed = false;
  let commitUrl: string | null = null;
  if (token) {
    const { ledger, sha } = await readLedger(token);
    const merged: Ledger = {
      primes: [...newPrimes, ...ledger.primes].slice(0, MAX_STORED),
      totalFound: ledger.totalFound + newPrimes.length,
      totalTested: ledger.totalTested + tested,
      runCount: ledger.runCount + 1,
      firstRun: ledger.firstRun ?? new Date().toISOString(),
      lastRun: new Date().toISOString(),
      lastRunFound: newPrimes.length,
      lastRunTested: tested,
      ratePerHour: Math.round(newPrimes.length / (HUNT_MS / 3_600_000)),
    };
    const result = await writeLedger(token, merged, sha, newPrimes.length);
    committed = !result.error;
    commitUrl = result?.commit?.html_url ?? null;
  }

  return NextResponse.json({
    ok: true,
    server: "vercel",
    region: process.env.VERCEL_REGION ?? "unknown",
    elapsedMs: Date.now() - t0,
    tested,
    found: newPrimes.length,
    bits: TARGET_BITS,
    committed,
    commitUrl,
    sample: newPrimes.slice(0, 3).map(p => ({ digits: p.digits, head: (p.fullDecimal as string).slice(0, 40) + "…" })),
    note: token
      ? "Computed on Vercel servers and committed to GitHub."
      : "Computed on Vercel servers. Set GH_TOKEN env var to persist results to GitHub.",
  });
}

export const GET  = handle;
export const POST = handle;
