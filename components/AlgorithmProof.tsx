"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Step {
  i: number;
  s: string;
  label: string;
}

interface ProofResult {
  exponent: number;
  mersenne: string;
  isPrime: boolean;
  steps: Step[];
  totalSteps: number;
  timeMs: number;
  firstDigits: string;
}

// Lucas-Lehmer — runs directly in main thread (p=89 is only 87 iterations)
function runLL(p: number): ProofResult {
  const t0 = performance.now();
  const mersenne = (1n << BigInt(p)) - 1n;
  let s = 4n;
  const steps: Step[] = [];
  const total = p - 2;

  for (let i = 0; i < total; i++) {
    s = (s * s - 2n) % mersenne;
    // Capture first 5 and last 5 iterations
    if (i < 5 || i >= total - 5) {
      steps.push({
        i,
        s: s.toString().length > 20 ? s.toString().slice(0, 20) + "…" : s.toString(),
        label: i === total - 1 ? (s === 0n ? "ZERO — PRIME" : "NONZERO — COMPOSITE") : `s${i + 1}`,
      });
    }
  }

  const isPrime = s === 0n;
  const mersenneStr = mersenne.toString();

  return {
    exponent: p,
    mersenne: mersenneStr,
    isPrime,
    steps,
    totalSteps: total,
    timeMs: performance.now() - t0,
    firstDigits: mersenneStr.slice(0, 15),
  };
}

const KNOWN_TESTS = [
  { p: 31, label: "2^31 − 1", known: "Prime (5th Mersenne)", digits: 10 },
  { p: 89, label: "2^89 − 1", known: "Prime (10th Mersenne, 1911)", digits: 27 },
  { p: 11, label: "2^11 − 1 = 2047", known: "Composite (= 23 × 89)", digits: 4 },
  { p: 23, label: "2^23 − 1 = 8388607", known: "Composite (= 47 × 178481)", digits: 7 },
];

export function AlgorithmProof() {
  const [result, setResult] = useState<ProofResult | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedP, setSelectedP] = useState(89);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runProof = useCallback(() => {
    if (running) return;
    setRunning(true);
    setResult(null);
    setVisibleSteps(0);

    // Small delay so the UI updates before the computation blocks
    setTimeout(() => {
      const r = runLL(selectedP);
      setResult(r);
      setRunning(false);
      // Animate steps appearing one by one
      let step = 0;
      timerRef.current = setInterval(() => {
        step++;
        setVisibleSteps(step);
        if (step >= r.steps.length) {
          clearInterval(timerRef.current!);
        }
      }, 120);
    }, 50);
  }, [running, selectedP]);

  return (
    <section className="relative py-28 px-4 overflow-hidden" id="proof">
      {/* Background grid */}
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-30" />

      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <div className="inline-block px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs tracking-widest uppercase mb-6">
            Algorithm Verification
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">
            The test runs here, right now.
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl leading-relaxed">
            Select a candidate below. The page will compute Lucas-Lehmer
            step-by-step and show you the exact iteration sequence. When the
            final value reaches zero, the number is provably prime — no
            approximation, no probability.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: controls */}
          <div className="lg:col-span-2 space-y-4">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="proof-card p-5 rounded-xl"
            >
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
                Select candidate
              </div>
              <div className="space-y-2">
                {KNOWN_TESTS.map((t) => (
                  <motion.button
                    key={t.p}
                    onClick={() => setSelectedP(t.p)}
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                      selectedP === t.p
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                        : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <div className="font-mono text-sm font-bold">{t.label}</div>
                    <div className="text-xs opacity-60 mt-0.5">{t.known}</div>
                  </motion.button>
                ))}
              </div>

              <motion.button
                onClick={runProof}
                disabled={running}
                whileHover={!running ? { scale: 1.02 } : {}}
                whileTap={!running ? { scale: 0.98 } : {}}
                className={`mt-5 w-full py-3 rounded-lg text-sm font-bold tracking-wide transition-all ${
                  running
                    ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {running ? (
                  <span className="flex items-center justify-center gap-2">
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                      className="inline-block w-3 h-3 border border-zinc-400 border-t-transparent rounded-full"
                    />
                    Computing...
                  </span>
                ) : (
                  "Run Lucas-Lehmer"
                )}
              </motion.button>
            </motion.div>

            {/* Math explanation */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="proof-card p-5 rounded-xl"
            >
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">
                The sequence
              </div>
              <div className="font-mono text-sm space-y-2 text-zinc-300">
                <div>
                  <span className="text-indigo-400">s</span>
                  <sub className="text-xs">0</sub>
                  {" = 4"}
                </div>
                <div>
                  <span className="text-indigo-400">s</span>
                  <sub className="text-xs">i</sub>
                  {" = (s"}
                  <sub className="text-xs">i-1</sub>
                  {"² − 2) mod M"}
                  <sub className="text-xs">p</sub>
                </div>
                <div className="pt-2 border-t border-zinc-800 text-zinc-400 text-xs leading-relaxed">
                  If{" "}
                  <span className="text-indigo-300 font-bold">
                    s<sub className="text-[10px]">p-2</sub>
                  </span>{" "}
                  equals zero, then 2^p − 1 is prime. No margin of error.
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right: live output */}
          <div className="lg:col-span-3">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="proof-card rounded-xl overflow-hidden h-full min-h-[400px]"
            >
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900 border-b border-zinc-800">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
                <span className="ml-3 text-xs text-zinc-500 font-mono">
                  lucas-lehmer.ts — live execution
                </span>
              </div>

              <div className="p-5 font-mono text-sm min-h-[360px]">
                {!result && !running && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-zinc-600 text-sm"
                  >
                    <span className="text-indigo-400">$</span> Select a candidate and click Run.
                    <br />
                    <span className="text-zinc-700">
                      The sequence will print here, step by step.
                    </span>
                  </motion.div>
                )}

                {running && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-indigo-300"
                  >
                    <span className="text-zinc-500">&gt;</span> Testing 2^{selectedP} − 1
                    <br />
                    <motion.span
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.8, repeat: Infinity }}
                    >
                      _
                    </motion.span>
                  </motion.div>
                )}

                {result && (
                  <div className="space-y-1">
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-zinc-400 mb-3"
                    >
                      <span className="text-indigo-400">$</span> lucasLehmer(p={result.exponent})
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-zinc-500 text-xs mb-3"
                    >
                      M_{result.exponent} = 2^{result.exponent} − 1
                      <br />
                      Running {result.totalSteps} iterations of s = (s² − 2) mod M
                      <br />
                      Computed in {result.timeMs.toFixed(1)}ms
                    </motion.div>

                    <div className="space-y-0.5">
                      {result.steps.slice(0, visibleSteps).map((step, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.15 }}
                          className="flex gap-3 text-xs"
                        >
                          <span className="text-zinc-600 w-16 shrink-0">
                            {step.label}
                          </span>
                          <span
                            className={
                              step.label.includes("ZERO")
                                ? "text-green-400 font-bold"
                                : step.label.includes("NONZERO")
                                ? "text-red-400 font-bold"
                                : "text-zinc-300"
                            }
                          >
                            {step.s}
                          </span>
                        </motion.div>
                      ))}

                      {/* Middle omission notice */}
                      {visibleSteps >= 5 && result.steps.length > 5 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-zinc-600 text-xs py-1"
                        >
                          ... {result.totalSteps - 10} intermediate steps ...
                        </motion.div>
                      )}
                    </div>

                    {/* Final verdict */}
                    <AnimatePresence>
                      {visibleSteps >= result.steps.length && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.4 }}
                          className={`mt-5 p-4 rounded-lg border ${
                            result.isPrime
                              ? "border-green-500/30 bg-green-500/10"
                              : "border-red-500/30 bg-red-500/10"
                          }`}
                        >
                          <div
                            className={`text-base font-bold mb-1 ${
                              result.isPrime ? "text-green-400" : "text-red-400"
                            }`}
                          >
                            {result.isPrime
                              ? "s_{p-2} = 0 — Mersenne prime confirmed."
                              : "s_{p-2} != 0 — Composite number."}
                          </div>
                          {result.isPrime && (
                            <div className="text-xs text-zinc-400 font-mono break-all">
                              {result.firstDigits}...
                              <span className="text-zinc-600 ml-2">
                                ({result.mersenne.length} digits total)
                              </span>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
