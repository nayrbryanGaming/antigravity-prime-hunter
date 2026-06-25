/**
 * Browser Web Worker — runs in visitors' browsers for distributed computation.
 * This runs in a separate thread so it never freezes the UI.
 *
 * Messages IN:
 *   { type: 'START', exponent: number }
 *   { type: 'STOP' }
 *   { type: 'STATUS' }
 *
 * Messages OUT:
 *   { type: 'PROGRESS', data: {...} }
 *   { type: 'RESULT', data: {...} }
 *   { type: 'STATUS', data: {...} }
 *   { type: 'FOUND', data: {...} }
 */

const KNOWN_MERSENNE = new Set([
  2, 3, 5, 7, 13, 17, 19, 31, 61, 89, 107, 127, 521, 607, 1279, 2203,
  2281, 3217, 4253, 4423, 9689, 9941, 11213, 19937, 21701, 23209, 44497,
  86243, 110503, 132049, 216091, 756839, 859433, 1257787, 1398269, 2976221,
  3021377, 6972593, 13466917, 20996011, 24036583, 25964951, 30402457,
  32582657, 37156667, 42643801, 43112609, 57885161, 74207281, 77232917,
  82589933, 136279841,
]);

let running = false;
let currentExponent = null;
let shouldStop = false;
let stats = {
  tested: 0,
  found: [],
  startTime: null,
  iterations: 0,
};

function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

function nextPrimeAfter(n) {
  let c = n + 2;
  while (!isPrime(c)) c += 2;
  return c;
}

function mersenneReduce(x, p, mersenne) {
  const pBig = BigInt(p);
  while (x >= mersenne) {
    const lo = x & mersenne;
    const hi = x >> pBig;
    x = lo + hi;
  }
  return x;
}

function mersenneDigits(p) {
  return Math.floor(p * Math.log10(2)) + 1;
}

async function lucasLehmer(p) {
  if (p === 2) return true;
  if (!isPrime(p)) return false;

  const mersenne = (1n << BigInt(p)) - 1n;
  let s = 4n;
  const total = p - 2;
  const batchSize = 500;
  const startTime = performance.now();

  for (let i = 0; i < total; i++) {
    if (shouldStop) return null;

    s = mersenneReduce(s * s - 2n, p, mersenne);
    stats.iterations++;

    if (i % batchSize === 0) {
      const elapsed = performance.now() - startTime;
      const rate = i / elapsed;
      const remaining = total - i;

      self.postMessage({
        type: 'PROGRESS',
        data: {
          exponent: p,
          iteration: i,
          total,
          percent: ((i / total) * 100).toFixed(6),
          elapsed: Math.round(elapsed),
          eta: Math.round(remaining / rate),
          digits: mersenneDigits(p),
          rate: rate.toFixed(2),
        }
      });

      // Yield
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return s === 0n;
}

async function huntLoop(startExponent) {
  running = true;
  shouldStop = false;
  stats.startTime = Date.now();
  let p = startExponent;

  // Ensure p is prime
  while (!isPrime(p)) p++;

  while (!shouldStop) {
    if (KNOWN_MERSENNE.has(p)) {
      p = nextPrimeAfter(p);
      continue;
    }

    currentExponent = p;
    stats.tested++;

    self.postMessage({
      type: 'STATUS',
      data: {
        status: 'testing',
        exponent: p,
        digits: mersenneDigits(p),
        tested: stats.tested,
        found: stats.found.length,
        uptime: Date.now() - stats.startTime,
      }
    });

    const result = await lucasLehmer(p);

    if (result === null) break; // stopped

    if (result) {
      const found = {
        exponent: p,
        digits: mersenneDigits(p),
        foundAt: new Date().toISOString(),
      };
      stats.found.push(found);
      self.postMessage({ type: 'FOUND', data: found });
    } else {
      self.postMessage({
        type: 'RESULT',
        data: { exponent: p, isPrime: false, digits: mersenneDigits(p) }
      });
    }

    p = nextPrimeAfter(p);
  }

  running = false;
  currentExponent = null;
}

self.onmessage = (e) => {
  const { type, exponent } = e.data;

  switch (type) {
    case 'START':
      if (!running) {
        huntLoop(exponent || 136_279_843);
      }
      break;
    case 'STOP':
      shouldStop = true;
      break;
    case 'STATUS':
      self.postMessage({
        type: 'STATUS',
        data: {
          status: running ? 'running' : 'idle',
          exponent: currentExponent,
          tested: stats.tested,
          found: stats.found.length,
          uptime: stats.startTime ? Date.now() - stats.startTime : 0,
          iterations: stats.iterations,
        }
      });
      break;
  }
};
