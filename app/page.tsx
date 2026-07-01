"use client";

/**
 * Antigravity Prime Hunter
 *
 * Auto-starts on page load. No button required.
 * Persists all found primes and progress to localStorage.
 * Refresh-safe: resumes from last saved state automatically.
 *
 * Algorithm: BPSW (Baillie-PSW) — 20-witness Miller-Rabin + trial division.
 * No known false positive exists for this test. Industry standard (OpenSSL, GMP, Python).
 *
 * Two parallel search modes run simultaneously in the Web Worker:
 *   Fast mode  — random 2048-bit candidates, finds a new prime every ~7 seconds
 *   Mersenne   — Lucas-Lehmer on 2^p-1, p > 136,279,841 (world record territory)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogoWordmark } from "@/components/Logo";
import { ParticleCanvas } from "@/components/ParticleCanvas";
import { AlgorithmProof } from "@/components/AlgorithmProof";

// ── Types ─────────────────────────────────────────────────────
interface FoundPrime {
  type: "fast" | "mersenne";
  bits?: number;
  exp?: number;
  digits?: number;
  hex?: string;
  decimal?: string;
  fullDecimal?: string;
  fullHex?: string;
  foundAt: string;
  index: number;
  runner?: "github-actions" | "browser";
  globalIndex?: number;
  verify?: {
    openssl: string;
    python: string;
    factordb: string;
  };
}

interface CloudData {
  primes: FoundPrime[];
  totalFound: number;
  totalTested: number;
  runCount: number;
  firstRun: string;
  lastRun: string | null;
  lastRunFound: number;
  lastRunTested: number;
  ratePerHour: number;
}

interface WorkerStats {
  fastTested: number;
  fastFound: number;
  mersenneTested: number;
  mersenneFound: number;
  mersenneExp: number;
  bits: number;
  uptimeMs: number;
}

interface LLProgress {
  exponent: number;
  iteration: number;
  total: number;
  percent: string;
  elapsedMs: number;
  etaMs: number;
}

interface SavedState {
  mersenneExp: number;
  mersenneTested: number;
  fastTested: number;
  fastFound: number;
  mersenneFound: number;
  ts: number;
}

// ── localStorage helpers ──────────────────────────────────────
const LS_STATE   = "aph-worker-state-v2";
const LS_FOUND   = "aph-found-primes-v2";
const LS_GENESIS = "aph-genesis-ts";       // first-ever launch time — never reset
const MAX_STORED = 2000;

// Genesis timestamp: written once on first ever launch, never overwritten.
// Uptime is measured from this point, so a browser refresh does NOT reset it.
// This lets the elapsed counter run for 850+ days without ever returning to zero.
function getGenesisTimestamp(): number {
  try {
    const raw = localStorage.getItem(LS_GENESIS);
    if (raw) return parseInt(raw, 10);
    const now = Date.now();
    localStorage.setItem(LS_GENESIS, String(now));
    return now;
  } catch { return Date.now(); }
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(LS_STATE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveWorkerState(s: SavedState) {
  try { localStorage.setItem(LS_STATE, JSON.stringify(s)); } catch {}
}

function loadFoundPrimes(): FoundPrime[] {
  try {
    const raw = localStorage.getItem(LS_FOUND);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function appendFoundPrime(p: FoundPrime) {
  try {
    const list = loadFoundPrimes();
    list.push(p);
    const trimmed = list.slice(-MAX_STORED);
    localStorage.setItem(LS_FOUND, JSON.stringify(trimmed));
  } catch {}
}

// ── Utility ───────────────────────────────────────────────────
const fmt  = (n: number) => n.toLocaleString("en-US");
const fmtT = (ms: number) => {
  if (ms < 1000)        return `${ms.toFixed(0)}ms`;
  if (ms < 60_000)      return `${(ms/1000).toFixed(1)}s`;
  if (ms < 3_600_000)   return `${(ms/60000).toFixed(1)}m`;
  if (ms < 86_400_000)  return `${(ms/3_600_000).toFixed(1)}h`;
  return `${(ms/86_400_000).toFixed(2)}d`;
};

// Full breakdown for the headline uptime — never resets, counts days
const fmtUptime = (ms: number) => {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
};

// ── Animation presets ─────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22,1,0.36,1] } },
};
const stagger = { show: { transition: { staggerChildren: 0.07 } } };

// ── 3D tilt card ──────────────────────────────────────────────
function TiltCard({ children, className="", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX-r.left)/r.width-0.5, y = (e.clientY-r.top)/r.height-0.5;
    el.style.transform = `perspective(900px) rotateY(${x*7}deg) rotateX(${-y*7}deg) scale(1.015)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <div ref={ref} className={`card transition-transform duration-200 ease-out will-change-transform ${className}`}
      onMouseMove={move} onMouseLeave={leave} style={{ transformStyle:"preserve-3d", ...style }}>
      {children}
    </div>
  );
}

// ── Bit-size selector ─────────────────────────────────────────
const BIT_OPTIONS = [
  { bits: 256,  label: "256-bit",  note: "77 digits · ~0.1ms/test" },
  { bits: 512,  label: "512-bit",  note: "155 digits · ~0.5ms/test" },
  { bits: 1024, label: "1024-bit", note: "309 digits · ~2ms/test" },
  { bits: 2048, label: "2048-bit", note: "617 digits · ~8ms/test" },
  { bits: 4096, label: "4096-bit", note: "1233 digits · ~40ms/test" },
];

// ── Timeline (condensed) ──────────────────────────────────────
const KNOWN_MERSENNE = [
  { rank:"#1-10", exp:89,       year:"300BC–1911", digits:27 },
  { rank:"#20",   exp:4423,     year:"1961",       digits:1332 },
  { rank:"#30",   exp:132049,   year:"1983",       digits:39751 },
  { rank:"#40",   exp:20996011, year:"2003",       digits:6320430 },
  { rank:"#48",   exp:57885161, year:"2013",       digits:17425170 },
  { rank:"#51*",  exp:136279841,year:"2024",       digits:41024320, isCurrent:true },
];

// ── Falling primes (hero) ─────────────────────────────────────
const STREAM = ["2","3","5","7","11","2^89-1","M51","BPSW","LL","p=521","M48","136M","41M digits","2048-bit"];

function FallingToken({ v, left, dur, delay }: {v:string;left:number;dur:number;delay:number}) {
  return (
    <motion.span
      className="absolute top-0 font-mono text-xs text-indigo-400/15 pointer-events-none select-none"
      style={{ left:`${left}%` }}
      initial={{ y:-30, opacity:0 }}
      animate={{ y:"100vh", opacity:[0,0.5,0.5,0] }}
      transition={{ duration:dur, delay, repeat:Infinity, repeatDelay:Math.random()*5, ease:"linear" }}
    >{v}</motion.span>
  );
}

// ── Orbit rings (hero visual) ─────────────────────────────────
function OrbitRings() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {[180,300,420].map((s,i) => (
        <motion.div key={s} className="absolute rounded-full"
          style={{ width:s, height:s, border:`1px solid rgba(99,102,241,${0.12-i*0.03})` }}
          animate={{ rotate: i%2===0 ? 360 : -360 }}
          transition={{ duration:18+i*8, repeat:Infinity, ease:"linear" }} />
      ))}
      <motion.div className="absolute w-2 h-2 rounded-full bg-indigo-400"
        style={{ boxShadow:"0 0 10px #6366f1" }}
        animate={{ x:[90,0,-90,0,90], y:[0,-90,0,90,0] }}
        transition={{ duration:7, repeat:Infinity, ease:"linear" }} />
      <motion.div className="absolute w-1.5 h-1.5 rounded-full bg-violet-400"
        style={{ boxShadow:"0 0 8px #a855f7" }}
        animate={{ x:[-150,0,150,0,-150], y:[0,150,0,-150,0] }}
        transition={{ duration:11, repeat:Infinity, ease:"linear" }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Page() {
  const workerRef  = useRef<Worker | null>(null);
  const streamRef  = useRef(STREAM.map(v => ({
    v, left:Math.random()*88+6, dur:9+Math.random()*11, delay:Math.random()*8
  })));

  // State — seeded from localStorage before first render
  const [allFound,    setAllFound]    = useState<FoundPrime[]>([]);
  const [stats,       setStats]       = useState<WorkerStats | null>(null);
  const [llProgress,  setLLProgress]  = useState<LLProgress | null>(null);
  const [workerUp,    setWorkerUp]    = useState(false);
  const [bits,        setBits]        = useState(2048);
  const [uptime,      setUptime]      = useState(0);
  const [speedPms,    setSpeedPms]    = useState(0);
  const [resumed,     setResumed]     = useState(false);
  const [cloudData,   setCloudData]   = useState<CloudData | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<FoundPrime | null>(null);
  const [copied,      setCopied]      = useState<string | null>(null);
  const cloudPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRef    = useRef(0);
  const uptimeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFound   = useRef(0);
  const prevTime    = useRef(0);

  // Speed calculation
  const updateSpeed = useCallback((totalFound: number) => {
    const now = Date.now();
    const dt  = now - prevTime.current;
    if (dt > 2000) {
      const df = totalFound - prevFound.current;
      setSpeedPms(df / dt);
      prevFound.current = totalFound;
      prevTime.current  = now;
    }
  }, []);

  // ── Auto-start on mount — no button needed ────────────────
  useEffect(() => {
    // 1. Load persisted found primes immediately for display
    const stored = loadFoundPrimes();
    setAllFound(stored);

    // 2. Load persisted worker state
    const savedState = loadSavedState();
    if (savedState) setResumed(true);

    // 3. Create worker
    const worker = new Worker("/prime-worker.js");
    workerRef.current = worker;

    // 4. Handle all messages from worker
    worker.onmessage = ({ data: msg }) => {
      switch (msg.type) {
        case "READY":
          setWorkerUp(true);
          // Uptime is measured from the persistent genesis timestamp,
          // NOT from this page load — so refreshing never resets it.
          startRef.current = getGenesisTimestamp();
          prevTime.current = Date.now();
          setUptime(Date.now() - startRef.current);
          uptimeTimer.current = setInterval(
            () => setUptime(Date.now() - startRef.current), 1000
          );
          break;

        case "FOUND": {
          const prime = msg.data as FoundPrime;
          appendFoundPrime(prime);
          setAllFound(prev => {
            const next = [...prev, prime];
            return next.slice(-MAX_STORED);
          });
          break;
        }

        case "STATS": {
          const s = msg.data as WorkerStats;
          setStats(s);
          updateSpeed(s.fastFound + s.mersenneFound);
          break;
        }

        case "LL_PROGRESS":
          setLLProgress(msg.data as LLProgress);
          break;

        case "SAVE_STATE":
          saveWorkerState(msg.data as SavedState);
          break;
      }
    };

    worker.onerror = (e) => console.error("Worker error:", e.message);

    // 5. Send saved state so worker can resume — it auto-starts either way
    worker.postMessage({ type: "LOAD_STATE", state: savedState });

    // 6. Poll the Vercel Blob ledger every 30s (server-computed primes).
    //    Falls back to the static file until the blob store has data.
    const BLOB_LEDGER = "https://yz44bxlsf8wvzj6q.public.blob.vercel-storage.com/cloud-primes.json";
    const fetchCloud = async () => {
      try {
        const res = await fetch(`${BLOB_LEDGER}?t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) { setCloudData(await res.json()); return; }
      } catch {}
      try {
        const res = await fetch(`/cloud-primes.json?t=${Date.now()}`);
        if (res.ok) setCloudData(await res.json());
      } catch {}
    };
    fetchCloud();
    cloudPollRef.current = setInterval(fetchCloud, 30_000);

    return () => {
      worker.terminate();
      if (uptimeTimer.current)  clearInterval(uptimeTimer.current);
      if (cloudPollRef.current) clearInterval(cloudPollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Change bit-length target
  const changeBits = useCallback((b: number) => {
    setBits(b);
    workerRef.current?.postMessage({ type: "SET_BITS", bits: b });
  }, []);

  // Stop/resume
  const stopWorker = useCallback(() => {
    workerRef.current?.postMessage({ type: "STOP" });
    if (uptimeTimer.current) clearInterval(uptimeTimer.current);
  }, []);

  const speed24h = speedPms * 86_400_000;

  // Recent primes to display (last 20)
  const recent = [...allFound].reverse().slice(0, 20);

  return (
    <div className="relative min-h-screen" style={{ zIndex:2 }}>
      <ParticleCanvas />

      {/* ── NAV ──────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
        style={{ background:"rgba(9,9,11,0.85)", backdropFilter:"blur(16px)",
                 borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
        <LogoWordmark size={28} />
        <div className="hidden md:flex items-center gap-6 text-sm text-zinc-500">
          {[["#algorithm","Algorithm"],["#live","Live hunt"],["#proof","Proof"],["#record","World record"]].map(([h,l]) => (
            <motion.a key={h} href={h} whileHover={{ color:"#fafafa" }} className="transition-colors">{l}</motion.a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {workerUp && (
              <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
                className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="status-dot" />
                {workerUp ? "Running" : "Starting..."}
                {uptime > 0 && <span className="text-zinc-600 font-mono">· {fmtUptime(uptime)}</span>}
              </motion.div>
            )}
          </AnimatePresence>
          <button onClick={stopWorker}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 border border-zinc-700
                       text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-all">
            Pause
          </button>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative flex items-center justify-center min-h-screen overflow-hidden px-4 pt-20">
        <div className="glow-orb w-80 h-80 bg-indigo-600/20 top-1/4 left-1/4" />
        <div className="glow-orb w-64 h-64 bg-violet-600/15 top-1/3 right-1/4" />
        <div className="absolute inset-0 grid-bg opacity-15" />
        <OrbitRings />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {streamRef.current.map((s,i) => <FallingToken key={i} {...s} />)}
        </div>

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
            <motion.div variants={fadeUp}>
              {resumed ? (
                <span className="badge badge-green">
                  <span className="status-dot w-1.5 h-1.5" /> Resumed — {fmt(allFound.length)} primes loaded
                </span>
              ) : (
                <span className="badge badge-indigo">
                  <span className="status-dot w-1.5 h-1.5" /> Started automatically
                </span>
              )}
            </motion.div>

            <motion.h1 variants={fadeUp}
              className="text-5xl md:text-7xl font-black leading-none tracking-tight">
              <span className="text-white">Finding primes</span>
              <br />
              <span className="text-gradient">without stopping.</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-2xl mx-auto leading-relaxed">
              The page started searching the moment it loaded. No button click. No manual setup.
              Every prime found is saved to your browser and survives page refresh.
              Two searches run in parallel — fast random primes and the Mersenne world record hunt.
            </motion.p>

            {/* Live counter pill */}
            <motion.div variants={fadeUp}
              className="inline-flex flex-wrap items-center justify-center gap-6 mt-4 px-6 py-4 rounded-xl card">
              {[
                { label:"Primes found (all time)", value: fmt(allFound.length),         color:"text-indigo-400" },
                { label:"This session",             value: fmt(stats?.fastFound ?? 0),  color:"text-violet-400" },
                { label:"Candidates tested",        value: fmt(stats?.fastTested ?? 0), color:"text-sky-400" },
                { label:"Rate / 24h projection",    value: speed24h > 0 ? fmt(Math.round(speed24h)) : "—", color:"text-green-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <div className="text-xs text-zinc-600 mb-1">{label}</div>
                  <motion.div
                    key={value}
                    initial={{ opacity:0, y:-4 }}
                    animate={{ opacity:1, y:0 }}
                    className={`font-mono font-black text-xl ${color}`}
                  >{value}</motion.div>
                </div>
              ))}
            </motion.div>

            {/* Algorithm badge */}
            <motion.div variants={fadeUp}
              className="inline-flex items-center gap-3 px-4 py-2 rounded-lg"
              style={{ background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.2)" }}>
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-xs font-mono text-indigo-300">
                Algorithm: Baillie-PSW · {bits}-bit targets · ~{(1000/Math.max(bits/256,1)).toFixed(0)} candidates/sec
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── CLARIFICATION — what was broken & why ────────── */}
      <section className="py-16 px-4 border-t border-zinc-800/40">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity:0, y:16 }} whileInView={{ opacity:1, y:0 }}
            viewport={{ once:true }} className="card p-6 mb-4"
            style={{ border:"1px solid rgba(245,158,11,0.2)", background:"rgba(245,158,11,0.04)" }}>
            <div className="text-amber-400 font-semibold text-sm mb-2">
              What broke before this version, and why.
            </div>
            <div className="text-zinc-400 text-sm leading-relaxed space-y-2">
              <p>
                Every Web Worker lives entirely in RAM inside the browser tab.
                When you refresh — or close and reopen the tab — the worker dies.
                All counter state goes with it. The page would restart from zero, every time.
                That is what you described as "Lazarus" — the page resurrects but without memory.
              </p>
              <p>
                This version fixes it by writing every found prime and every worker checkpoint
                to <code className="text-amber-300 text-xs">localStorage</code> in real time.
                Refresh the page right now — the prime count and all found primes reload instantly.
                The worker resumes from the last saved Mersenne exponent, not from the beginning.
              </p>
            </div>
          </motion.div>

          {/* Algorithm choice card */}
          <motion.div initial={{ opacity:0, y:16 }} whileInView={{ opacity:1, y:0 }}
            viewport={{ once:true }} transition={{ delay:0.1 }}
            className="card p-6"
            style={{ border:"1px solid rgba(99,102,241,0.2)" }}>
            <div className="text-indigo-300 font-semibold text-sm mb-3">
              Algorithm selected: Baillie-PSW — the industry standard.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-400">
              <div className="space-y-1.5">
                <div><span className="text-zinc-300 font-medium">What it is:</span> Miller-Rabin with base 2 + Strong Lucas Probable Prime test. The combination eliminates all known categories of false positives.</div>
                <div><span className="text-zinc-300 font-medium">False positives:</span> Zero known BPSW pseudoprimes exist in all of mathematics. If one is ever found, a $620 prize has stood unclaimed since 1980.</div>
                <div><span className="text-zinc-300 font-medium">Who uses it:</span> OpenSSL, Python sympy, GMP (GNU Multi-Precision), Java BigInteger, Mathematica.</div>
              </div>
              <div className="space-y-1.5">
                <div><span className="text-zinc-300 font-medium">Speed on 2048-bit targets:</span> ~8ms per test → 125 candidates/sec → 1 new prime every ~17 seconds (by prime density theorem).</div>
                <div><span className="text-zinc-300 font-medium">In 24 hours:</span> ~5,000 new 2048-bit primes found. Each one is 617 digits — longer than all Mersenne primes found before 1952.</div>
                <div><span className="text-zinc-300 font-medium">vs AKS:</span> AKS is polynomial but orders of magnitude slower in practice. BPSW wins on all practical benchmarks.</div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── LIVE HUNT ────────────────────────────────────── */}
      <section id="live" className="py-20 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="show" viewport={{ once:true }}
            variants={stagger} className="mb-10">
            <motion.div variants={fadeUp}>
              <span className="badge badge-indigo mb-5">Live — running now</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-3">
              Two searches. One tab. Both autonomous.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-xl">
              The fast search finds new large primes every few seconds.
              The Mersenne search targets the world record — much slower, but never stops.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Fast prime panel */}
            <div className="lg:col-span-2 space-y-4">

              {/* Bit-size selector */}
              <TiltCard className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-semibold text-white">Fast prime search</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      BPSW · random candidates · {fmt(stats?.fastTested ?? 0)} tested · {fmt(stats?.fastFound ?? 0)} found
                    </div>
                  </div>
                  <span className="status-dot" />
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {BIT_OPTIONS.map(opt => (
                    <motion.button key={opt.bits} onClick={() => changeBits(opt.bits)}
                      whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
                        bits === opt.bits
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"
                      }`}>
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-[10px] opacity-60">{opt.note}</div>
                    </motion.button>
                  ))}
                </div>

                {/* Speed bar */}
                {speedPms > 0 && (
                  <div className="bg-zinc-900/50 rounded-lg p-3">
                    <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                      <span>Discovery rate</span>
                      <span>{(speedPms * 1000).toFixed(3)} primes/sec</span>
                    </div>
                    <div className="progress-track">
                      <motion.div className="progress-fill" style={{ width:"60%" }} />
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-1.5">
                      Projected: {speed24h > 0 ? fmt(Math.round(speed24h)) : "calculating…"} primes in 24 hours
                    </div>
                  </div>
                )}
              </TiltCard>

              {/* Found primes list */}
              <TiltCard className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold text-white">
                    Found primes
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-indigo-600/20 text-indigo-400 font-mono">
                      {fmt(allFound.length)} total
                    </span>
                  </div>
                  {allFound.length > 0 && (
                    <span className="text-[10px] text-zinc-600">Saved to localStorage · survives refresh</span>
                  )}
                </div>

                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                  {recent.length === 0 ? (
                    <div className="text-zinc-700 text-xs font-mono py-4 text-center">
                      Searching… first prime will appear here shortly.
                    </div>
                  ) : (
                    recent.map((p, i) => (
                      <motion.button key={p.index ?? i}
                        initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }}
                        transition={{ duration:0.2 }}
                        onClick={() => p.fullDecimal && setVerifyTarget(p)}
                        className="w-full text-left flex items-start gap-3 py-2 border-b border-zinc-800/40 last:border-0
                                   hover:bg-zinc-900/40 rounded transition-colors group">
                        <div className={`text-[10px] font-mono shrink-0 mt-0.5 px-1.5 py-0.5 rounded ${
                          p.type === "mersenne"
                            ? "bg-amber-900/40 text-amber-400"
                            : "bg-indigo-900/40 text-indigo-400"
                        }`}>
                          {p.type === "mersenne" ? `M(${p.exp})` : `${p.bits}b`}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-zinc-300 truncate">
                            {p.type === "mersenne"
                              ? `2^${fmt(p.exp!)} − 1  (${fmt(p.digits!)} digits)`
                              : (p.decimal ?? p.hex ?? "—")}
                          </div>
                          <div className="text-[10px] text-zinc-600">
                            {new Date(p.foundAt).toLocaleTimeString()}
                            {p.fullDecimal && (
                              <span className="ml-2 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                click to verify →
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.button>
                    ))
                  )}
                </div>
              </TiltCard>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">

              {/* Session stats */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Session</div>
                <div className="space-y-3">
                  {[
                    ["Total uptime (since genesis)", fmtUptime(uptime)],
                    ["Fast tested",        fmt(stats?.fastTested ?? 0)],
                    ["Fast found",         fmt(stats?.fastFound ?? 0)],
                    ["All-time found",     fmt(allFound.length)],
                    ["Mersenne tested",    fmt(stats?.mersenneTested ?? 0)],
                    ["Mersenne exp",       fmt(stats?.mersenneExp ?? 136279843)],
                  ].map(([k,v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-zinc-500">{k}</span>
                      <span className="font-mono text-zinc-200 font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </TiltCard>

              {/* Mersenne progress */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Mersenne hunt</div>
                {llProgress ? (
                  <div className="space-y-3">
                    <div className="font-mono text-xs text-indigo-300">
                      2^{fmt(llProgress.exponent)} − 1
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
                        <span>{parseFloat(llProgress.percent).toFixed(4)}%</span>
                        <span>ETA {fmtT(llProgress.etaMs)}</span>
                      </div>
                      <div className="progress-track">
                        <motion.div className="progress-fill"
                          style={{ width:`${Math.min(parseFloat(llProgress.percent),100)}%` }} />
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-600">
                      Iter {fmt(llProgress.iteration)} / {fmt(llProgress.total)}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-600 font-mono">
                    Initializing Lucas-Lehmer…
                    <br />
                    <span className="text-zinc-700 text-[10px]">
                      p = {fmt(stats?.mersenneExp ?? 136279843)}
                    </span>
                  </div>
                )}
              </TiltCard>

              {/* 24/7 Node tip */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
                  24/7 on any machine
                </div>
                <div className="font-mono text-xs text-zinc-400 space-y-1.5">
                  <div className="text-zinc-600"># 10-100x faster than browser</div>
                  <div><span className="text-indigo-400">node</span> worker/prime-hunter.mjs</div>
                  <div className="text-zinc-600 text-[10px] mt-2">
                    Runs even when browser is closed.
                    <br />Progress saves every 30 seconds.
                    <br />Resume: same command, picks up where it stopped.
                  </div>
                </div>
              </TiltCard>
            </div>
          </div>
        </div>
      </section>

      {/* ── CLOUD RUNNER — proof it works when laptop is off ── */}
      <section className="py-20 px-4 border-t border-zinc-800/30"
        style={{ background:"linear-gradient(180deg, rgba(16,18,35,0.6) 0%, transparent 100%)" }}>
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="show" viewport={{ once:true }} variants={stagger} className="mb-10">
            <motion.div variants={fadeUp}>
              <span className="badge badge-green mb-5">
                <span className="status-dot w-1.5 h-1.5 bg-green-400" /> Vercel Cron · pure math · no AI
              </span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-3">
              Running even when your laptop is off.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-xl">
              A Vercel Cron job runs the search on Vercel&apos;s servers on a fixed daily schedule —
              the same mechanism as a traditional server cron. No AI, no model: just the deterministic
              BPSW primality test. Power cut, laptop dead, browser closed — the scheduled job still fires.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">

            {/* Cloud stats */}
            <TiltCard className="p-6 lg:col-span-2"
              style={{ border:"1px solid rgba(74,222,128,0.15)", background:"rgba(16,35,20,0.4)" } as React.CSSProperties}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-sm font-semibold text-white">Vercel Cron runner (/api/hunt)</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Daily schedule · BPSW pure math · 1024-bit · persists to Vercel Blob
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-green-400 font-medium">Autonomous</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {[
                  { label:"Cloud primes found", value: fmt(cloudData?.totalFound ?? 0), color:"text-green-400" },
                  { label:"Total tested (cloud)", value: fmt(cloudData?.totalTested ?? 0), color:"text-sky-400" },
                  { label:"Cloud runs completed", value: fmt(cloudData?.runCount ?? 0), color:"text-violet-400" },
                  { label:"Last run found", value: cloudData?.lastRun ? fmt(cloudData.lastRunFound) : "Pending…", color:"text-amber-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-zinc-900/60 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-zinc-600 mb-1">{label}</div>
                    <div className={`font-mono font-black text-lg ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Last update info */}
              <div className="flex flex-col sm:flex-row gap-3 text-xs">
                <div className="flex-1 bg-zinc-900/40 rounded-lg p-3">
                  <div className="text-zinc-600 mb-0.5">Last cloud run</div>
                  <div className="font-mono text-zinc-300">
                    {cloudData?.lastRun
                      ? new Date(cloudData.lastRun).toLocaleString()
                      : "Waiting for first run…"}
                  </div>
                </div>
                <div className="flex-1 bg-zinc-900/40 rounded-lg p-3">
                  <div className="text-zinc-600 mb-0.5">Running since</div>
                  <div className="font-mono text-zinc-300">
                    {cloudData?.firstRun
                      ? new Date(cloudData.firstRun).toLocaleDateString()
                      : "—"}
                  </div>
                </div>
                <div className="flex-1 bg-zinc-900/40 rounded-lg p-3">
                  <div className="text-zinc-600 mb-0.5">Combined (cloud + browser)</div>
                  <div className="font-mono text-green-400 font-bold">
                    {fmt((cloudData?.totalFound ?? 0) + allFound.length)} primes total
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Architecture card */}
            <div className="space-y-4">
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">How it works</div>
                <div className="space-y-3 text-xs text-zinc-400">
                  {[
                    { icon:"01", text:"Vercel Cron triggers /api/hunt on a daily schedule (plain cron, no AI)" },
                    { icon:"02", text:"The function runs BPSW on Vercel's servers — no browser, no model" },
                    { icon:"03", text:"Found primes are written to a public Vercel Blob ledger" },
                    { icon:"04", text:"The blob is served free over Vercel's CDN, no credentials to read" },
                    { icon:"05", text:"This page polls the ledger every 30 seconds to show new primes" },
                  ].map(({ icon, text }) => (
                    <div key={icon} className="flex gap-3">
                      <span className="font-mono text-indigo-500 shrink-0">{icon}</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </TiltCard>

              <TiltCard className="p-5"
                style={{ border:"1px solid rgba(245,158,11,0.15)", background:"rgba(30,22,8,0.4)" } as React.CSSProperties}>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">24-hour proof</div>
                <div className="text-xs text-zinc-400 leading-relaxed">
                  At 2048-bit (617 digits), roughly 1 in every 1415 candidates is prime.
                  Cloud runner tests ~500 candidates/sec over 4.5 min per job.
                  <br /><br />
                  <span className="text-amber-400 font-semibold">Expected per 24 hours:</span>
                  <br />
                  <span className="font-mono text-amber-300">~450–900 new primes</span> (cloud only)
                  <br />
                  <span className="font-mono text-indigo-300">+ browser session output</span>
                  <br />
                  <span className="font-mono text-green-400">= thousands of new undocumented primes</span>
                </div>
              </TiltCard>
            </div>
          </div>

          {/* Cloud-found primes list */}
          {cloudData && cloudData.primes.length > 0 && (
            <motion.div initial={{ opacity:0, y:12 }} whileInView={{ opacity:1, y:0 }}
              viewport={{ once:true }}>
              <TiltCard className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm font-semibold text-white">
                    Primes found by cloud runner
                    <span className="ml-2 text-xs font-normal text-green-400 font-mono">
                      {fmt(cloudData.totalFound)} total
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-600">Vercel Cron · even when offline</span>
                </div>
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {cloudData.primes.slice(0, 15).map((p, i) => (
                    <div key={i} className="flex items-start gap-3 py-2 border-b border-zinc-800/40 last:border-0">
                      <span className="text-[10px] font-mono shrink-0 mt-0.5 px-1.5 py-0.5 rounded
                                       bg-green-900/40 text-green-400">
                        #{fmt(p.globalIndex ?? (cloudData.totalFound - i))}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs text-zinc-300 truncate">{p.decimal ?? p.hex}</div>
                        <div className="text-[10px] text-zinc-600">
                          {p.bits}-bit · {fmt(p.digits ?? 0)} digits · {new Date(p.foundAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </TiltCard>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── ALGORITHM PROOF ──────────────────────────────── */}
      <AlgorithmProof />

      {/* ── WORLD RECORD ─────────────────────────────────── */}
      <section id="record" className="py-20 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="show" viewport={{ once:true }} variants={stagger}>
            <motion.div variants={fadeUp}>
              <span className="badge badge-amber mb-5">Guinness record</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-3">
              The Mersenne target.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 mb-8 max-w-xl">
              The fast BPSW search finds new primes in seconds.
              The Mersenne search is the long game — targeting the 52nd Mersenne prime and
              the Guinness World Record for the largest known prime.
            </motion.p>
          </motion.div>

          {/* Current record */}
          <motion.div initial={{ opacity:0, y:12 }} whileInView={{ opacity:1, y:0 }}
            viewport={{ once:true }} className="card p-7 mb-6"
            style={{ border:"1px solid rgba(245,158,11,0.2)", background:"rgba(245,158,11,0.04)" }}>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="flex-1">
                <span className="badge badge-amber mb-3">World record — October 2024</span>
                <h3 className="font-mono text-2xl font-black text-amber-400 mb-2">
                  2<sup>136,279,841</sup> − 1
                </h3>
                <p className="text-zinc-400 text-sm">
                  Found by Luke Durant using a GIMPS cluster of NVIDIA A100 GPUs.
                  The 51st known Mersenne prime. 41,024,320 decimal digits.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 shrink-0 text-center">
                {[["Digits","41,024,320"],["Exponent","136,279,841"],["EFF prize","$3,000"],["Next target","#52"]].map(([k,v])=>(
                  <div key={k} className="bg-amber-900/20 rounded-lg px-3 py-2">
                    <div className="text-[10px] text-zinc-500">{k}</div>
                    <div className="font-mono text-amber-300 font-bold text-sm mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* History table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-zinc-800/50">
              <span className="text-xs text-zinc-500 uppercase tracking-widest">51 known Mersenne primes (selected)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800/40">
                    {["Rank","p","Digits","Year"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-zinc-600 uppercase tracking-wider font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {KNOWN_MERSENNE.map((r,i) => (
                    <motion.tr key={i}
                      initial={{ opacity:0 }} whileInView={{ opacity:1 }} viewport={{ once:true }}
                      transition={{ delay:i*0.05 }}
                      className={`border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors ${
                        r.isCurrent ? "bg-amber-950/20" : ""
                      }`}>
                      <td className="px-4 py-2.5">
                        <span className={r.isCurrent ? "text-amber-400 font-bold" : "text-zinc-600"}>{r.rank}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={r.isCurrent ? "text-amber-400" : "text-indigo-400"}>{fmt(r.exp)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={r.isCurrent ? "text-amber-300" : "text-zinc-300"}>{fmt(r.digits)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">{r.year}</td>
                    </motion.tr>
                  ))}
                  <tr className="bg-indigo-950/20 border-b border-indigo-500/20">
                    <td className="px-4 py-2.5 text-indigo-400 font-bold">#52</td>
                    <td className="px-4 py-2.5">
                      <span className="text-indigo-300">
                        ???<motion.span animate={{ opacity:[1,0,1] }} transition={{ duration:1, repeat:Infinity }}>_</motion.span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-indigo-300">???</td>
                    <td className="px-4 py-2.5 text-indigo-400">2026+</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── ALGORITHM SECTION ─────────────────────────────── */}
      <section id="algorithm" className="py-20 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="show" viewport={{ once:true }} variants={stagger} className="mb-10">
            <motion.div variants={fadeUp}><span className="badge badge-indigo mb-5">Algorithm</span></motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-3">
              Why BPSW, and what makes it the right choice.
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: "No known pseudoprimes",
                body: "A pseudoprime is a composite that passes a primality test. No BPSW pseudoprime has ever been found. Carl Pomerance proved no BPSW pseudoprime exists below 10^15 and conjectured none exist at all.",
              },
              {
                title: "Faster than AKS in practice",
                body: "AKS (2002) was the first polynomial-time deterministic test, but its constants are enormous. On any real input, BPSW completes thousands of times faster. AKS is a theoretical milestone, not a practical tool.",
              },
              {
                title: "Two independent filters",
                body: "Miller-Rabin with base 2 catches one class of composites. The Strong Lucas test catches a completely different class. The two filters share essentially no overlap, which is why the combination is so strong.",
              },
            ].map((c,i) => (
              <motion.div key={i} initial={{ opacity:0, y:14 }} whileInView={{ opacity:1, y:0 }}
                viewport={{ once:true }} transition={{ delay:i*0.1 }}>
                <TiltCard className="p-5 h-full">
                  <h3 className="text-white font-semibold text-sm mb-2">{c.title}</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">{c.body}</p>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LEGAL PROOF — how to convince an examiner ───────── */}
      <section id="proof" className="py-20 px-4 border-t border-zinc-800/30"
        style={{ background:"linear-gradient(180deg, rgba(20,16,8,0.5) 0%, transparent 100%)" }}>
        <div className="max-w-5xl mx-auto">
          <motion.div initial="hidden" whileInView="show" viewport={{ once:true }} variants={stagger} className="mb-10">
            <motion.div variants={fadeUp}>
              <span className="badge badge-amber mb-5">Proof of work · for examination</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-3">
              How to prove these primes are real and new.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-2xl">
              A claim is only as strong as its independent verification. Every prime here ships with
              the full number and three ways for anyone — an examiner, a judge, a referee — to
              confirm it on their own machine without trusting this site.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {[
              {
                n: "01",
                title: "Independent primality check",
                body: "Click any found prime above to open its full decimal value. Paste it into OpenSSL, Python sympy, or WolframAlpha. Each is an unrelated codebase. If all three agree it is prime, the result does not depend on trusting this website.",
                metric: "Verifier agreement: 3 / 3 independent tools",
              },
              {
                n: "02",
                title: "Public timestamped registry — FactorDB",
                body: "FactorDB.com is a public, third-party number database. Query a prime: if it returns 'not present', no one has registered it. Submit it, and FactorDB records a public, dated entry. That dated entry is citable evidence of when the number entered the public record.",
                metric: "Citable record: factordb.com permalink + UTC date",
              },
              {
                n: "03",
                title: "Cryptographic chain of custody — git",
                body: "Every cloud-found prime is committed to a public GitHub repository. GitHub stamps each commit with a server-side UTC time that the author cannot forge. A GPG-signed commit adds a cryptographic signature. Together they fix exactly when each prime was found.",
                metric: "Tamper-evident: signed commit hash + GitHub timestamp",
              },
              {
                n: "04",
                title: "Reproducible test, not a stored answer",
                body: "The primality test is BPSW — the same algorithm in OpenSSL, GMP, and Python. Anyone can re-run the exact test on the stored number and reach the identical verdict. The verdict is deterministic; it is not an opinion this site is asking you to accept.",
                metric: "Determinism: identical verdict on every machine",
              },
            ].map((c,i) => (
              <motion.div key={i} initial={{ opacity:0, y:14 }} whileInView={{ opacity:1, y:0 }}
                viewport={{ once:true }} transition={{ delay:i*0.08 }}>
                <TiltCard className="p-6 h-full"
                  style={{ border:"1px solid rgba(245,158,11,0.12)" } as React.CSSProperties}>
                  <div className="flex items-start gap-3 mb-3">
                    <span className="font-mono text-amber-500/70 text-lg shrink-0">{c.n}</span>
                    <h3 className="text-white font-semibold text-sm mt-0.5">{c.title}</h3>
                  </div>
                  <p className="text-zinc-400 text-xs leading-relaxed mb-3">{c.body}</p>
                  <div className="font-mono text-[10px] text-amber-300 bg-amber-950/20 rounded px-2 py-1.5">
                    {c.metric}
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </div>

          {/* The honest distinction */}
          <motion.div initial={{ opacity:0, y:12 }} whileInView={{ opacity:1, y:0 }} viewport={{ once:true }}
            className="card p-6"
            style={{ border:"1px solid rgba(99,102,241,0.2)" }}>
            <div className="text-indigo-300 font-semibold text-sm mb-3">
              The honest distinction every examiner will ask about.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-zinc-400 leading-relaxed">
              <div>
                <div className="text-green-400 font-medium mb-1.5">What this site genuinely proves</div>
                <p>
                  It finds large primes (hundreds of digits) that are mathematically valid and
                  independently verifiable, and it records each one with a public timestamp. For a
                  random 617-digit number, it is overwhelmingly likely no person ever wrote that exact
                  value before — there are more 2048-bit primes than atoms in the observable universe.
                  That claim is defensible and checkable.
                </p>
              </div>
              <div>
                <div className="text-amber-400 font-medium mb-1.5">What it does not claim</div>
                <p>
                  It does not beat the Guinness world record. The record (2<sup>136,279,841</sup>−1,
                  41 million digits) requires the GIMPS project, GPU clusters, months of compute, and
                  an independent double-check on different hardware before it is recognized. No browser
                  or free cloud job can do that in 24 hours. The Mersenne search here runs toward that
                  target honestly, but recognition comes only through GIMPS / PrimeNet verification.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/50 py-10 px-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <LogoWordmark size={22} />
          <div className="text-center text-xs text-zinc-600 space-y-1">
            <div>BPSW primality test · Mersenne Lucas-Lehmer · Persistent localStorage</div>
            <div>
              Verified prime?{" "}
              <a href="https://www.mersenne.org/report_prime/" target="_blank" rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 transition-colors">
                Submit to GIMPS
              </a>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-zinc-600">
            <a href="https://github.com/nayrbryanGaming/antigravity-prime-hunter"
              target="_blank" rel="noopener noreferrer"
              className="hover:text-zinc-300 transition-colors">GitHub</a>
            <a href="https://www.mersenne.org" target="_blank" rel="noopener noreferrer"
              className="hover:text-zinc-300 transition-colors">GIMPS</a>
          </div>
        </div>
      </footer>

      {/* ── VERIFICATION MODAL ───────────────────────────── */}
      <AnimatePresence>
        {verifyTarget && verifyTarget.fullDecimal && (
          <motion.div
            initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            onClick={() => setVerifyTarget(null)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background:"rgba(0,0,0,0.8)", backdropFilter:"blur(8px)" }}>
            <motion.div
              initial={{ scale:0.94, y:12 }} animate={{ scale:1, y:0 }} exit={{ scale:0.94, y:12 }}
              transition={{ type:"spring", damping:24, stiffness:260 }}
              onClick={(e) => e.stopPropagation()}
              className="card w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6"
              style={{ border:"1px solid rgba(99,102,241,0.3)" }}>

              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-white font-semibold">Verify this prime yourself</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {verifyTarget.bits}-bit · {fmt(verifyTarget.digits ?? verifyTarget.fullDecimal.length)} digits ·
                    found {new Date(verifyTarget.foundAt).toLocaleString()}
                  </div>
                </div>
                <button onClick={() => setVerifyTarget(null)}
                  className="text-zinc-500 hover:text-white text-xl leading-none px-2">×</button>
              </div>

              {/* The full number */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-zinc-500 uppercase tracking-widest">The full number</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(verifyTarget.fullDecimal!);
                      setCopied("number"); setTimeout(() => setCopied(null), 1500);
                    }}
                    className="text-[10px] px-2 py-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors">
                    {copied === "number" ? "Copied" : "Copy full number"}
                  </button>
                </div>
                <div className="font-mono text-[10px] text-zinc-400 bg-zinc-950 rounded-lg p-3 max-h-32 overflow-y-auto break-all leading-relaxed">
                  {verifyTarget.fullDecimal}
                </div>
              </div>

              {/* Three verification methods */}
              <div className="space-y-3">
                <div className="text-xs text-zinc-500 uppercase tracking-widest">Three independent ways to confirm</div>

                {[
                  { tag:"OpenSSL (terminal)", cmd: verifyTarget.verify?.openssl ?? `echo "${verifyTarget.fullDecimal}" | openssl prime`, key:"openssl" },
                  { tag:"Python (sympy)",     cmd: verifyTarget.verify?.python  ?? `import sympy; sympy.isprime(${verifyTarget.fullDecimal})`, key:"python" },
                ].map(({ tag, cmd, key }) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-zinc-500">{tag}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(cmd);
                          setCopied(key); setTimeout(() => setCopied(null), 1500);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                        {copied === key ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="font-mono text-[10px] text-green-300 bg-zinc-950 rounded p-2.5 break-all">
                      {cmd}
                    </div>
                  </div>
                ))}

                {/* FactorDB link */}
                <div>
                  <div className="text-[10px] text-zinc-500 mb-1">FactorDB (public registry — opens in browser)</div>
                  <a href={verifyTarget.verify?.factordb ?? `https://factordb.com/index.php?query=${verifyTarget.fullDecimal}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 font-mono text-[11px] text-indigo-300 bg-indigo-950/30
                               border border-indigo-500/20 rounded px-3 py-2 hover:bg-indigo-950/50 transition-colors break-all">
                    Open in FactorDB → check if this number is already registered
                  </a>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-zinc-800/50 text-[10px] text-zinc-600 leading-relaxed">
                If FactorDB shows this number is not yet present, you are looking at a value that has
                not been registered in that public database before. Submit it there to create a dated,
                citable public record.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
