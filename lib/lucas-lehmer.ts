/**
 * Lucas-Lehmer primality test for Mersenne numbers M_p = 2^p - 1
 * This is THE algorithm used by GIMPS to find world record primes.
 *
 * All known Mersenne prime exponents (record holders):
 * 2, 3, 5, 7, 13, 17, 19, 31, 61, 89, 107, 127, 521, 607, 1279, 2203,
 * 2281, 3217, 4253, 4423, 9689, 9941, 11213, 19937, 21701, 23209, 44497,
 * 86243, 110503, 132049, 216091, 756839, 859433, 1257787, 1398269, 2976221,
 * 3021377, 6972593, 13466917, 20996011, 24036583, 25964951, 30402457,
 * 32582657, 37156667, 42643801, 43112609, 57885161, 74207281, 77232917,
 * 82589933, 136279841  ← CURRENT WORLD RECORD (Oct 2024, 41M digits)
 *
 * Next target: find the 52nd Mersenne prime, p > 136,279,841
 */

export interface LucasLehmerResult {
  exponent: number;
  mersenne: bigint;
  isPrime: boolean;
  digits: number;
  iterationsCompleted: number;
  timeMs: number;
}

export interface TestProgress {
  exponent: number;
  currentIteration: number;
  totalIterations: number;
  percent: number;
  elapsedMs: number;
  estimatedTotalMs: number;
}

// Known Mersenne prime exponents for reference
export const KNOWN_MERSENNE_EXPONENTS = [
  2, 3, 5, 7, 13, 17, 19, 31, 61, 89, 107, 127, 521, 607, 1279, 2203,
  2281, 3217, 4253, 4423, 9689, 9941, 11213, 19937, 21701, 23209, 44497,
  86243, 110503, 132049, 216091, 756839, 859433, 1257787, 1398269, 2976221,
  3021377, 6972593, 13466917, 20996011, 24036583, 25964951, 30402457,
  32582657, 37156667, 42643801, 43112609, 57885161, 74207281, 77232917,
  82589933, 136279841,
];

export const CURRENT_RECORD_EXPONENT = 136279841;
export const CURRENT_RECORD_DIGITS = 41024320;

/**
 * Modular multiplication for BigInt: (a * b) mod m
 * Uses built-in BigInt which handles arbitrary precision.
 */
function modMul(a: bigint, b: bigint, m: bigint): bigint {
  return (a * b) % m;
}

/**
 * Modular squaring optimized for Mersenne numbers.
 * For M_p = 2^p - 1, reduction is faster using bit shifts.
 * x mod (2^p - 1) = (x >> p) + (x & (2^p - 1))
 */
function mersenneReduce(x: bigint, p: number, mersenne: bigint): bigint {
  const pBig = BigInt(p);
  const lo = x & mersenne;
  const hi = x >> pBig;
  const result = lo + hi;
  return result >= mersenne ? result - mersenne : result;
}

/**
 * Lucas-Lehmer test.
 * Returns true if 2^p - 1 is prime.
 */
export function lucasLehmer(p: number): boolean {
  if (p === 2) return true;
  if (p % 2 === 0) return false;

  const mersenne = (BigInt(1) << BigInt(p)) - BigInt(1);
  let s = BigInt(4);

  for (let i = 0; i < p - 2; i++) {
    s = mersenneReduce(s * s - BigInt(2), p, mersenne);
    if (s < BigInt(0)) s += mersenne;
  }

  return s === BigInt(0);
}

/**
 * Lucas-Lehmer with progress callback (for UI updates).
 * onProgress called every `reportInterval` iterations.
 */
export async function lucasLehmerWithProgress(
  p: number,
  onProgress: (progress: TestProgress) => void,
  reportInterval = 1000,
  signal?: AbortSignal
): Promise<LucasLehmerResult> {
  const start = Date.now();

  if (p === 2) {
    return {
      exponent: 2,
      mersenne: BigInt(3),
      isPrime: true,
      digits: 1,
      iterationsCompleted: 0,
      timeMs: 0,
    };
  }

  const mersenne = (BigInt(1) << BigInt(p)) - BigInt(1);
  const digits = Math.floor(p * Math.log10(2)) + 1;
  let s = BigInt(4);
  const totalIterations = p - 2;

  for (let i = 0; i < totalIterations; i++) {
    if (signal?.aborted) break;

    s = mersenneReduce(s * s - BigInt(2), p, mersenne);
    if (s < BigInt(0)) s += mersenne;

    if (i % reportInterval === 0 && i > 0) {
      const elapsed = Date.now() - start;
      const rate = i / elapsed;
      const remaining = totalIterations - i;

      onProgress({
        exponent: p,
        currentIteration: i,
        totalIterations,
        percent: (i / totalIterations) * 100,
        elapsedMs: elapsed,
        estimatedTotalMs: elapsed + remaining / rate,
      });

      // Yield to event loop
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const timeMs = Date.now() - start;
  const isPrime = s === BigInt(0);

  return {
    exponent: p,
    mersenne,
    isPrime,
    digits,
    iterationsCompleted: totalIterations,
    timeMs,
  };
}

/**
 * Count digits of 2^p - 1
 */
export function mersenneDigits(p: number): number {
  return Math.floor(p * Math.log10(2)) + 1;
}

/**
 * Format a large number of digits for display
 */
export function formatDigitCount(digits: number): string {
  if (digits >= 1_000_000) return `${(digits / 1_000_000).toFixed(2)}M`;
  if (digits >= 1_000) return `${(digits / 1_000).toFixed(1)}K`;
  return digits.toString();
}

/**
 * Get first N digits of 2^p - 1 (approximation using logarithms)
 */
export function mersenneFirstDigits(p: number, n = 20): string {
  // 2^p = 10^(p * log10(2))
  const log10 = p * Math.log10(2);
  const fractional = log10 - Math.floor(log10);
  const firstDigits = Math.pow(10, fractional + n - 1);
  return Math.floor(firstDigits).toString().substring(0, n);
}
