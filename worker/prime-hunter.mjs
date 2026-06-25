#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         ANTIGRAVITY PRIME HUNTER — 24/7 LOCAL WORKER            ║
 * ║     Lucas-Lehmer Mersenne Prime Search Engine (Node.js)          ║
 * ║                                                                  ║
 * ║  CURRENT WORLD RECORD: 2^136,279,841 - 1 (Oct 2024, GIMPS)      ║
 * ║  41,024,320 digits — 51st known Mersenne prime                   ║
 * ║                                                                  ║
 * ║  TARGET: Find the 52nd Mersenne prime (p > 136,279,841)          ║
 * ║  Run: node worker/prime-hunter.mjs                               ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * STRATEGI:
 * - Jangan mulai dari 1! Semua prima kecil sudah diketahui.
 * - Target: Mersenne primes 2^p - 1 dengan p prime
 * - Algoritma: Lucas-Lehmer test (satu-satunya cara verify Mersenne)
 * - Progress disimpan ke data/progress.json — bisa resume kapan saja
 *
 * HOW TO RUN 24/7:
 *   Windows: node worker/prime-hunter.mjs
 *   With PM2: pm2 start worker/prime-hunter.mjs --name prime-hunter
 *   Linux/Mac: nohup node worker/prime-hunter.mjs &
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROGRESS_FILE = resolve(ROOT, "data", "progress.json");
const FOUND_FILE = resolve(ROOT, "data", "found-primes.json");

// ── Config ──────────────────────────────────────────────────────────
const CONFIG = {
  // Start searching from this exponent (after world record)
  // For realistic testing on your machine, start from a smaller value
  // Change START_FROM to 136_279_843 to search in world record territory
  START_FROM: 136_279_843,

  // How often to save progress (every N iterations of Lucas-Lehmer)
  SAVE_EVERY_ITERATIONS: 10_000,

  // How often to print status to console (milliseconds)
  PRINT_EVERY_MS: 5_000,

  // For the web dashboard — update this file for live preview
  STATUS_FILE: resolve(ROOT, "data", "status.json"),
};

// Known Mersenne prime exponents (for reference/skip)
const KNOWN_MERSENNE = new Set([
  2, 3, 5, 7, 13, 17, 19, 31, 61, 89, 107, 127, 521, 607, 1279, 2203,
  2281, 3217, 4253, 4423, 9689, 9941, 11213, 19937, 21701, 23209, 44497,
  86243, 110503, 132049, 216091, 756839, 859433, 1257787, 1398269, 2976221,
  3021377, 6972593, 13466917, 20996011, 24036583, 25964951, 30402457,
  32582657, 37156667, 42643801, 43112609, 57885161, 74207281, 77232917,
  82589933, 136279841,
]);

// ── Utils ────────────────────────────────────────────────────────────

function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

function mersenneDigits(p) {
  return Math.floor(p * Math.log10(2)) + 1;
}

function formatNum(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTime(ms) {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}days`;
}

function ensureDir(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Progress persistence ─────────────────────────────────────────────

function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
    } catch {}
  }
  return {
    currentExponent: CONFIG.START_FROM,
    testedCount: 0,
    foundPrimes: [],
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(state) {
  ensureDir(PROGRESS_FILE);
  state.lastUpdated = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
}

function saveStatus(status) {
  ensureDir(CONFIG.STATUS_FILE);
  writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));
}

function loadFoundPrimes() {
  if (existsSync(FOUND_FILE)) {
    try {
      return JSON.parse(readFileSync(FOUND_FILE, "utf-8"));
    } catch {}
  }
  return [];
}

function saveFoundPrime(prime) {
  const found = loadFoundPrimes();
  found.push(prime);
  ensureDir(FOUND_FILE);
  writeFileSync(FOUND_FILE, JSON.stringify(found, null, 2));
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  🏆 NEW MERSENNE PRIME FOUND!!!                          ║");
  console.log(`║  2^${prime.exponent} - 1                                 ║`);
  console.log(`║  Digits: ${formatNum(prime.digits)}                      ║`);
  console.log(`║  Found at: ${prime.foundAt}                              ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\n!! SUBMIT TO GIMPS: https://www.mersenne.org/report_prime/ !!\n");
}

// ── Mersenne Modular Reduction ────────────────────────────────────────
// x mod (2^p - 1) using bit shifts — much faster than generic modulo

function mersenneReduce(x, p, mersenne) {
  const pBig = BigInt(p);
  while (x >= mersenne) {
    const lo = x & mersenne;
    const hi = x >> pBig;
    x = lo + hi;
  }
  return x;
}

// ── Lucas-Lehmer Test ────────────────────────────────────────────────

async function lucasLehmer(p, onProgress) {
  if (!isPrime(p)) return false;
  if (p === 2) return true;

  const mersenne = (1n << BigInt(p)) - 1n;
  let s = 4n;
  const total = p - 2;
  const startTime = performance.now();
  let lastSave = 0;
  let lastPrint = 0;

  for (let i = 0; i < total; i++) {
    s = mersenneReduce(s * s - 2n, p, mersenne);

    const now = performance.now();

    if (i - lastSave >= CONFIG.SAVE_EVERY_ITERATIONS) {
      lastSave = i;
      onProgress({
        iteration: i,
        total,
        percent: (i / total) * 100,
        elapsed: now - startTime,
        s_sample: s.toString().slice(0, 30),
      });
    }

    if (now - lastPrint >= CONFIG.PRINT_EVERY_MS) {
      lastPrint = now;
      const pct = ((i / total) * 100).toFixed(4);
      const elapsed = now - startTime;
      const eta = (elapsed / i) * (total - i);
      process.stdout.write(
        `\r  [LL p=${formatNum(p)}] iter ${formatNum(i)}/${formatNum(total)} (${pct}%) ` +
        `elapsed=${formatTime(elapsed)} ETA=${formatTime(eta)}    `
      );
    }

    // Yield every 100K iters to not block event loop
    if (i % 100_000 === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  const isPrimeMersenne = s === 0n;
  process.stdout.write("\n");
  return isPrimeMersenne;
}

// ── Main Loop ────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║      ANTIGRAVITY PRIME HUNTER — Lucas-Lehmer 24/7 Worker        ║");
  console.log("║      Searching for the 52nd Mersenne Prime                       ║");
  console.log("║      Current Record: 2^136,279,841 - 1 (41M digits, 2024)       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");

  const state = loadProgress();

  // Find next prime exponent to test
  let p = state.currentExponent;
  while (!isPrime(p)) p++;

  console.log(`▶ Resuming from exponent p = ${formatNum(p)}`);
  console.log(`▶ Tested so far: ${formatNum(state.testedCount)} candidates`);
  console.log(`▶ Found so far: ${state.foundPrimes.length} new Mersenne primes`);
  console.log(`▶ Target: 2^p - 1 with p > ${formatNum(CONFIG.START_FROM)}`);
  console.log("");
  console.log("Press Ctrl+C to stop (progress is saved automatically)");
  console.log("─".repeat(68));
  console.log("");

  process.on("SIGINT", () => {
    console.log("\n\n⏸  Pausing... Saving progress...");
    saveProgress(state);
    console.log(`✅ Progress saved. Resume with: node worker/prime-hunter.mjs`);
    process.exit(0);
  });

  while (true) {
    if (KNOWN_MERSENNE.has(p)) {
      console.log(`  [SKIP] p=${formatNum(p)} — already known Mersenne prime`);
      p = nextPrimeAfter(p);
      continue;
    }

    const digits = mersenneDigits(p);
    console.log(`\n▶ Testing 2^${formatNum(p)} - 1 (${formatNum(digits)} digits)`);

    state.currentExponent = p;
    state.testedCount++;

    const startTime = performance.now();

    let lastSaveTime = Date.now();

    const result = await lucasLehmer(p, (progress) => {
      // Save progress to file periodically
      const now = Date.now();
      if (now - lastSaveTime > 30_000) {
        lastSaveTime = now;
        saveProgress(state);
        saveStatus({
          mode: "mersenne",
          currentExponent: p,
          currentIteration: progress.iteration,
          totalIterations: progress.total,
          percent: progress.percent,
          digits,
          testedCount: state.testedCount,
          foundCount: state.foundPrimes.length,
          elapsedMs: progress.elapsed,
          lastUpdated: new Date().toISOString(),
          workerRunning: true,
        });
      }
    });

    const timeMs = performance.now() - startTime;

    if (result) {
      const prime = {
        exponent: p,
        mersenne: `2^${p} - 1`,
        digits,
        foundAt: new Date().toISOString(),
        timeMs,
        rank: `${KNOWN_MERSENNE.size + state.foundPrimes.length + 1}th known Mersenne prime`,
      };
      state.foundPrimes.push(prime);
      saveFoundPrime(prime);
    } else {
      console.log(`  ✗ 2^${formatNum(p)} - 1 is composite (${formatTime(timeMs)})`);
    }

    saveProgress(state);

    // Move to next prime exponent
    p = nextPrimeAfter(p);
  }
}

function nextPrimeAfter(n) {
  let candidate = n + 2;
  while (!isPrime(candidate)) candidate += 2;
  return candidate;
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
