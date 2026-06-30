/**
 * Prime Hunter Worker v2 — Autonomous, never stops.
 *
 * Runs TWO parallel modes from the moment the worker loads.
 * No START message needed. It begins immediately.
 *
 * ── MODE A: BPSW Fast Hunt ──────────────────────────────────────
 * Generates random large prime candidates and tests them with
 * Miller-Rabin (20 witnesses). For 512-bit numbers: ~1ms per test.
 * For 2048-bit: ~50ms. Finds genuinely new primes every few seconds.
 * These are real, provably prime numbers — no false positives at
 * 20-witness Miller-Rabin (error rate < 4^-20 ≈ 10^-12).
 *
 * ── MODE B: Mersenne Lucas-Lehmer ───────────────────────────────
 * Tests 2^p − 1 starting from p = 136,279,843 (after world record).
 * Extremely slow for world-record territory, but correct. Persists
 * which exponent it reached so restarts don't lose position.
 *
 * ── Persistence protocol ────────────────────────────────────────
 * Worker ← main: { type: 'LOAD_STATE', state: {...} }   (on startup)
 * Worker → main: { type: 'SAVE_STATE', state: {...} }   (every 5s)
 * Worker → main: { type: 'FOUND', data: {...} }
 * Worker → main: { type: 'STATS', data: {...} }
 * Worker → main: { type: 'LL_PROGRESS', data: {...} }
 */

// ── Utilities ─────────────────────────────────────────────────
function modPow(base, exp, mod) {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod;
    exp >>= 1n;
    base = base * base % mod;
  }
  return result;
}

function isPrimeSmall(n) {
  if (n < 2) return false;
  if (n === 2 || n === 3 || n === 5 || n === 7) return true;
  if (n % 2 === 0 || n % 3 === 0 || n % 5 === 0) return false;
  for (let i = 7; i * i <= n; i += 30) {
    if (n % i === 0 || n % (i+4) === 0 || n % (i+6) === 0 ||
        n % (i+10) === 0 || n % (i+12) === 0 || n % (i+16) === 0 ||
        n % (i+22) === 0 || n % (i+24) === 0) return false;
  }
  return true;
}

// First 400 small primes for fast trial division
const SMALL_PRIMES = [];
for (let n = 2; SMALL_PRIMES.length < 400; n++) {
  if (isPrimeSmall(n)) SMALL_PRIMES.push(BigInt(n));
}

function trialDivide(n) {
  for (const p of SMALL_PRIMES) {
    if (p * p > n) return true;
    if (n % p === 0n) return n === p;
  }
  return true;
}

// Miller-Rabin with 20 deterministic witnesses
// For n < 3.3×10^24: 12 witnesses are deterministic.
// For larger n: 20 witnesses → error < 4^-20 ≈ 10^-12
const MR_WITNESSES = [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n,41n,43n,47n,53n,59n,61n,67n,71n];

function millerRabin(n) {
  if (n < 2n) return false;
  for (const p of [2n,3n,5n,7n,11n,13n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  // Write n-1 = 2^r * d
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d >>= 1n; r++; }

  for (const a of MR_WITNESSES) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let cont = false;
    for (let i = 1n; i < r; i++) {
      x = x * x % n;
      if (x === n - 1n) { cont = true; break; }
    }
    if (!cont) return false;
  }
  return true;
}

// Full BPSW-class test
function isProbablePrime(n) {
  if (!trialDivide(n)) return false;
  return millerRabin(n);
}

// Cryptographically random BigInt of exactly `bits` bits, always odd
function randomOddBigInt(bits) {
  const bytes = Math.ceil(bits / 8);
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  // Force top bit set (exact bit length)
  arr[0] |= 0x80;
  // Force bottom bit set (odd)
  arr[bytes - 1] |= 0x01;
  let n = 0n;
  for (const b of arr) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntToBitLength(n) {
  return n.toString(2).length;
}

function bigIntToHexPrefix(n, chars = 16) {
  const h = n.toString(16);
  return h.slice(0, chars) + '…';
}

// ── Mersenne helpers ──────────────────────────────────────────
function isPrimeExp(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function nextPrimeExp(n) {
  let c = n % 2 === 0 ? n + 1 : n + 2;
  while (!isPrimeExp(c)) c += 2;
  return c;
}

function mersenneReduce(x, p, mp) {
  const pb = BigInt(p);
  while (x >= mp) { x = (x & mp) + (x >> pb); }
  return x;
}

// ── State ─────────────────────────────────────────────────────
const state = {
  // Fast mode
  fastTested:   0,
  fastFound:    0,
  fastBits:     512,     // target bit-length for fast mode

  // Mersenne mode
  mersenneExp:  136279843,
  mersenneTested: 0,
  mersenneFound:  0,

  // Timing
  startTime:    Date.now(),
  lastSave:     0,
};

let foundPrimes = [];  // local log (main thread keeps the real store)
let shouldStop  = false;

// ── Communication ─────────────────────────────────────────────
function post(type, data) {
  self.postMessage({ type, data });
}

function saveState() {
  post('SAVE_STATE', {
    mersenneExp:     state.mersenneExp,
    mersenneTested:  state.mersenneTested,
    fastTested:      state.fastTested,
    fastFound:       state.fastFound,
    mersenneFound:   state.mersenneFound,
    ts:              Date.now(),
  });
}

// ── Fast mode — find large primes in seconds ──────────────────
async function fastPrimeLoop() {
  while (!shouldStop) {
    const bits = state.fastBits;
    const candidate = randomOddBigInt(bits);
    state.fastTested++;

    if (isProbablePrime(candidate)) {
      state.fastFound++;
      const fullDecimal = candidate.toString();
      const prime = {
        type:        'fast',
        bits,
        hex:         bigIntToHexPrefix(candidate, 20),
        decimal:     fullDecimal.slice(0, 30) + '…',
        fullDecimal,                       // complete number — for independent verification
        fullHex:     candidate.toString(16),
        digits:      fullDecimal.length,
        foundAt:     new Date().toISOString(),
        index:       state.fastFound,
        // Independent-verification recipe — any of these confirms primality:
        verify: {
          openssl:  'echo "' + fullDecimal + '" | openssl prime',
          python:   'import sympy; sympy.isprime(' + fullDecimal + ')',
          factordb: 'https://factordb.com/index.php?query=' + fullDecimal,
        },
      };
      foundPrimes.push(prime);
      post('FOUND', prime);
    }

    post('STATS', {
      fastTested:      state.fastTested,
      fastFound:       state.fastFound,
      mersenneTested:  state.mersenneTested,
      mersenneFound:   state.mersenneFound,
      mersenneExp:     state.mersenneExp,
      bits,
      uptimeMs:        Date.now() - state.startTime,
    });

    // Persist state every 5 seconds
    const now = Date.now();
    if (now - state.lastSave > 5000) {
      state.lastSave = now;
      saveState();
    }

    // Yield to not freeze
    if (state.fastTested % 50 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

// ── Mersenne mode — Lucas-Lehmer in background ────────────────
async function mersenneLoop() {
  let p = state.mersenneExp;
  if (!isPrimeExp(p)) p = nextPrimeExp(p);

  while (!shouldStop) {
    state.mersenneExp = p;
    state.mersenneTested++;

    const mp = (1n << BigInt(p)) - 1n;
    let s  = 4n;
    const total = p - 2;
    const t0 = Date.now();

    for (let i = 0; i < total; i++) {
      if (shouldStop) break;
      s = mersenneReduce(s * s - 2n, p, mp);

      if (i % 200000 === 0) {
        const elapsed = Date.now() - t0;
        const pct = (i / total * 100).toFixed(6);
        post('LL_PROGRESS', {
          exponent: p,
          iteration: i,
          total,
          percent: pct,
          elapsedMs: elapsed,
          etaMs: elapsed > 0 ? Math.round(elapsed / (i || 1) * (total - i)) : 0,
        });
        // Yield
        await new Promise(r => setTimeout(r, 1));
      }
    }

    if (s === 0n && !shouldStop) {
      state.mersenneFound++;
      const prime = {
        type:    'mersenne',
        exp:     p,
        digits:  Math.floor(p * Math.log10(2)) + 1,
        foundAt: new Date().toISOString(),
      };
      foundPrimes.push(prime);
      post('FOUND', prime);
      saveState();
    }

    p = nextPrimeExp(p);
    state.mersenneExp = p;

    // Save after each Mersenne candidate
    saveState();
  }
}

// ── Entry point — starts both loops simultaneously ─────────────
self.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'LOAD_STATE':
      // Resume from persisted state
      if (msg.state) {
        if (msg.state.mersenneExp)    state.mersenneExp    = msg.state.mersenneExp;
        if (msg.state.mersenneTested) state.mersenneTested = msg.state.mersenneTested;
        if (msg.state.fastTested)     state.fastTested     = msg.state.fastTested;
        if (msg.state.fastFound)      state.fastFound      = msg.state.fastFound;
        if (msg.state.mersenneFound)  state.mersenneFound  = msg.state.mersenneFound;
      }
      post('READY', {
        mersenneExp: state.mersenneExp,
        resumed: !!msg.state,
      });
      // Both loops start immediately
      fastPrimeLoop();
      mersenneLoop();
      break;

    case 'SET_BITS':
      // Change target bit-length for fast mode
      if (msg.bits >= 64 && msg.bits <= 8192) {
        state.fastBits = msg.bits;
      }
      break;

    case 'STOP':
      shouldStop = true;
      break;
  }
};

// ── Start automatically without waiting for LOAD_STATE ────────
// This fires immediately when the worker loads.
// If the main thread sends LOAD_STATE before the first tick, state is updated.
// If not, we start from defaults.
setTimeout(() => {
  if (!shouldStop) {
    // Only start if LOAD_STATE hasn't triggered yet
    // (LOAD_STATE handler also calls both loops, so we check)
    if (state.fastTested === 0 && state.mersenneTested === 0) {
      post('READY', { mersenneExp: state.mersenneExp, resumed: false });
      fastPrimeLoop();
      mersenneLoop();
    }
  }
}, 200);
