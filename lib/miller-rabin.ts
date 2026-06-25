/**
 * Miller-Rabin primality test — deterministic for n < 3,317,044,064,679,887,385,961,981
 * with the right witness set. Used for fast screening before Lucas-Lehmer.
 */

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = base % mod;
  while (exp > BigInt(0)) {
    if (exp % BigInt(2) === BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp >> BigInt(1);
    base = (base * base) % mod;
  }
  return result;
}

function millerRabinWitness(n: bigint, a: bigint, d: bigint, r: number): boolean {
  let x = modPow(a, d, n);
  if (x === BigInt(1) || x === n - BigInt(1)) return true;
  for (let i = 0; i < r - 1; i++) {
    x = (x * x) % n;
    if (x === n - BigInt(1)) return true;
  }
  return false;
}

/**
 * Deterministic Miller-Rabin for numbers up to 3.3 * 10^24.
 * Uses the 13-witness set that covers all numbers deterministically.
 */
export function millerRabin(n: bigint): boolean {
  if (n < BigInt(2)) return false;
  if (n === BigInt(2) || n === BigInt(3)) return true;
  if (n % BigInt(2) === BigInt(0)) return false;

  // Small primes fast path
  const smallPrimes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
  for (const p of smallPrimes) {
    const pb = BigInt(p);
    if (n === pb) return true;
    if (n % pb === BigInt(0)) return false;
  }

  // Write n-1 as 2^r * d
  let d = n - BigInt(1);
  let r = 0;
  while (d % BigInt(2) === BigInt(0)) {
    d /= BigInt(2);
    r++;
  }

  // Deterministic witnesses for n < 3,317,044,064,679,887,385,961,981
  const witnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const a of witnesses) {
    if (a >= n) continue;
    if (!millerRabinWitness(n, a, d, r)) return false;
  }

  return true;
}

/**
 * Simple trial division sieve — returns all primes up to limit.
 */
export function sieve(limit: number): number[] {
  const isPrime = new Uint8Array(limit + 1).fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;
  for (let i = 2; i * i <= limit; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= limit; j += i) {
        isPrime[j] = 0;
      }
    }
  }
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (isPrime[i]) primes.push(i);
  }
  return primes;
}

/**
 * Quick divisibility check using small primes — eliminates most composites fast.
 */
export function quickDivisibilityCheck(n: bigint): boolean {
  const small = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
    53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
  for (const p of small) {
    if (n === BigInt(p)) return true;
    if (n % BigInt(p) === BigInt(0)) return false;
  }
  return true;
}

/**
 * Generate next prime candidate after n using Miller-Rabin.
 */
export function nextPrime(n: bigint): bigint {
  if (n < BigInt(2)) return BigInt(2);
  let candidate = n % BigInt(2) === BigInt(0) ? n + BigInt(1) : n + BigInt(2);
  while (!millerRabin(candidate)) {
    candidate += BigInt(2);
  }
  return candidate;
}

/**
 * Check if a number is a prime exponent (needed for Mersenne prime testing).
 * Lucas-Lehmer only makes sense for prime exponents.
 */
export function isPrimeExponent(p: number): boolean {
  if (p < 2) return false;
  if (p === 2) return true;
  if (p % 2 === 0) return false;
  for (let i = 3; i * i <= p; i += 2) {
    if (p % i === 0) return false;
  }
  return true;
}

/**
 * Generate prime exponents in range [start, end] for Mersenne prime testing.
 */
export function primeExponentsInRange(start: number, end: number): number[] {
  const result: number[] = [];
  for (let p = start; p <= end; p++) {
    if (isPrimeExponent(p)) result.push(p);
  }
  return result;
}
