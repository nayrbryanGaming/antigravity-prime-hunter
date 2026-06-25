"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useScroll, useTransform, useInView } from "framer-motion";
import { LogoWordmark } from "@/components/Logo";
import { ParticleCanvas } from "@/components/ParticleCanvas";
import { AlgorithmProof } from "@/components/AlgorithmProof";

// ── Animation presets ────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const fadeLeft = {
  hidden: { opacity: 0, x: -24 },
  show:   { opacity: 1, x: 0,   transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const stagger = { show: { transition: { staggerChildren: 0.08 } } };
const staggerFast = { show: { transition: { staggerChildren: 0.05 } } };

// ── Static data ───────────────────────────────────────────────
const TIMELINE = [
  { rank: 1,   exp: 2,         digits: 1,        year: "~300 BC", label: "Euclid era" },
  { rank: 5,   exp: 13,        digits: 4,        year: "1461",    label: "Anonymous" },
  { rank: 12,  exp: 127,       digits: 39,       year: "1876",    label: "Lucas" },
  { rank: 14,  exp: 521,       digits: 157,      year: "1952",    label: "Robinson (SWAC)" },
  { rank: 20,  exp: 4423,      digits: 1332,     year: "1961",    label: "Hurwitz" },
  { rank: 25,  exp: 21701,     digits: 6533,     year: "1978",    label: "Noll & Nickel" },
  { rank: 30,  exp: 132049,    digits: 39751,    year: "1983",    label: "Nelson & Slowinski" },
  { rank: 35,  exp: 1398269,   digits: 420921,   year: "1996",    label: "Armengaud (GIMPS)" },
  { rank: 40,  exp: 20996011,  digits: 6320430,  year: "2003",    label: "Shafer (GIMPS)" },
  { rank: 45,  exp: 37156667,  digits: 11185272, year: "2008",    label: "Elvenich (GIMPS)" },
  { rank: 48,  exp: 57885161,  digits: 17425170, year: "2013",    label: "Cooper (GIMPS)" },
  { rank: 50,  exp: 77232917,  digits: 23249425, year: "2018",    label: "Pace (GIMPS)" },
  { rank: 51,  exp: 82589933,  digits: 24862048, year: "2018",    label: "Laroche (GIMPS)" },
  { rank: "51*", exp: 136279841, digits: 41024320, year: "2024",  label: "GIMPS — Current Record", isCurrent: true },
];

const STATS = [
  { label: "Current record exponent",  value: "136,279,841",  unit: "p",       accent: "indigo" },
  { label: "Digits in world record",   value: "41,024,320",   unit: "digits",  accent: "violet" },
  { label: "Known Mersenne primes",    value: "51",           unit: "total",   accent: "sky" },
  { label: "EFF prize — 1B digits",    value: "$150,000",     unit: "USD",     accent: "amber" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Pick a prime exponent",
    body: "Lucas-Lehmer only applies when p is prime. We start from p = 136,279,843 — the next prime after the current world record exponent — and work upward.",
  },
  {
    step: "02",
    title: "Build the sequence",
    body: "Starting from s = 4, each iteration squares the current value, subtracts 2, and reduces modulo 2^p − 1. This runs exactly p − 2 times.",
  },
  {
    step: "03",
    title: "Check the remainder",
    body: "If the final value is zero, the number is prime — definitively, without any chance of error. If it is not zero, the number is composite and we move on.",
  },
  {
    step: "04",
    title: "Save and continue",
    body: "Progress writes to disk every 30 seconds. Close the terminal, come back tomorrow — the search picks up exactly where it stopped.",
  },
  {
    step: "05",
    title: "Submit the find",
    body: "If a new prime surfaces, the GIMPS team runs independent verification. After confirmation, a Guinness submission follows.",
  },
];

// ── Number counter component ──────────────────────────────────
function Counter({ target, duration = 1.5 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = (now - start) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [inView, target, duration]);

  return <span ref={ref}>{count.toLocaleString()}</span>;
}

// ── 3D tilt card ───────────────────────────────────────────────
function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) scale(1.01)`;
  };

  const handleMouseLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(800px) rotateY(0) rotateX(0) scale(1)";
  };

  return (
    <div
      ref={ref}
      className={`card transition-transform duration-200 ease-out will-change-transform ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  );
}

// ── Falling prime stream (hero background) ────────────────────
const STREAM_PRIMES = [
  "2","3","5","7","11","13","17","19","23","29","31","37","41","43","47",
  "2^89-1","M51","136279841","p=521","p=9689","2^127-1","M48","41M digits",
];

function FallingPrime({ value, left, duration, delay }: {
  value: string; left: number; duration: number; delay: number;
}) {
  return (
    <motion.div
      className="absolute top-0 font-mono text-xs text-indigo-400/20 pointer-events-none select-none whitespace-nowrap"
      style={{ left: `${left}%` }}
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: "100vh", opacity: [0, 0.6, 0.6, 0] }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatDelay: Math.random() * 4,
        ease: "linear",
      }}
    >
      {value}
    </motion.div>
  );
}

// ── Orbit rings (hero) ────────────────────────────────────────
function OrbitRings() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {[200, 320, 440].map((size, i) => (
        <motion.div
          key={size}
          className="absolute rounded-full"
          style={{
            width: size,
            height: size,
            border: `1px solid rgba(99,102,241,${0.12 - i * 0.03})`,
          }}
          animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
          transition={{ duration: 20 + i * 10, repeat: Infinity, ease: "linear" }}
        />
      ))}
      {/* Orbiting dot */}
      <motion.div
        className="absolute w-2 h-2 rounded-full bg-indigo-400"
        style={{ boxShadow: "0 0 12px #6366f1" }}
        animate={{
          x: [100, 0, -100, 0, 100],
          y: [0, -100, 0, 100, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        className="absolute w-1.5 h-1.5 rounded-full bg-violet-400"
        style={{ boxShadow: "0 0 8px #a855f7" }}
        animate={{
          x: [-160, 0, 160, 0, -160],
          y: [0, 160, 0, -160, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

// ── Worker types ──────────────────────────────────────────────
interface WorkerProgress {
  exponent: number;
  iteration: number;
  total: number;
  percent: string;
  elapsed: number;
  eta: number;
  digits: number;
  rate: string;
}

interface FoundPrime { exponent: number; digits: number; foundAt: string; }

// ── Main page ─────────────────────────────────────────────────
export default function Page() {
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroScale   = useTransform(scrollY, [0, 400], [1, 0.96]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<WorkerProgress | null>(null);
  const [found, setFound] = useState<FoundPrime[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [uptime, setUptime] = useState(0);
  const [totalTested, setTotalTested] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef  = useRef(0);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [msg, ...prev].slice(0, 40));
  }, []);

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (uptimeRef.current) clearInterval(uptimeRef.current);
  }, []);

  const startHunt = useCallback(() => {
    workerRef.current?.terminate();
    const w = new Worker("/prime-worker.js");
    workerRef.current = w;

    w.onmessage = ({ data }) => {
      if (data.type === "PROGRESS") setProgress(data.data);
      if (data.type === "STATUS") setTotalTested(data.data.tested ?? 0);
      if (data.type === "RESULT") addLog(`Composite: 2^${data.data.exponent.toLocaleString()} − 1`);
      if (data.type === "FOUND") { setFound(p => [data.data, ...p]); addLog(`PRIME FOUND: 2^${data.data.exponent} − 1`); }
    };

    w.postMessage({ type: "START", exponent: 136_279_843 });
    setRunning(true);
    startRef.current = Date.now();
    uptimeRef.current = setInterval(() => setUptime(Date.now() - startRef.current), 1000);
    addLog("Search started from p = 136,279,843");
  }, [addLog]);

  const stopHunt = useCallback(() => {
    workerRef.current?.postMessage({ type: "STOP" });
    setTimeout(() => { workerRef.current?.terminate(); workerRef.current = null; }, 400);
    setRunning(false);
    if (uptimeRef.current) clearInterval(uptimeRef.current);
    addLog("Search paused.");
  }, [addLog]);

  const fmt = (n: number) => n.toLocaleString("en-US");
  const fmtTime = (ms: number) => {
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  // Falling primes (randomized on mount)
  const streamItems = useRef(
    STREAM_PRIMES.map((v) => ({
      value: v,
      left: Math.random() * 90 + 5,
      duration: 8 + Math.random() * 12,
      delay: Math.random() * 8,
    }))
  );

  return (
    <div className="relative min-h-screen" style={{ zIndex: 2 }}>
      <ParticleCanvas />

      {/* ── NAV ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
        style={{ background: "rgba(9,9,11,0.8)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <LogoWordmark size={28} />

        <div className="hidden md:flex items-center gap-6 text-sm text-zinc-500">
          {[["#proof", "How it works"], ["#record", "World record"], ["#hunt", "Live hunt"]].map(([href, label]) => (
            <motion.a
              key={href}
              href={href}
              whileHover={{ color: "#fafafa" }}
              className="transition-colors"
            >
              {label}
            </motion.a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {running && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="hidden sm:flex items-center gap-2 text-xs text-zinc-400"
            >
              <span className="status-dot" />
              {fmtTime(uptime)}
            </motion.div>
          )}
          <motion.button
            onClick={running ? stopHunt : startHunt}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              running
                ? "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {running ? "Pause" : "Start hunting"}
          </motion.button>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative flex items-center justify-center min-h-screen overflow-hidden px-4"
      >
        {/* Glow orbs */}
        <div className="glow-orb w-96 h-96 bg-indigo-600/20 top-1/4 left-1/4" />
        <div className="glow-orb w-72 h-72 bg-violet-600/15 top-1/3 right-1/4" />

        {/* Orbit rings */}
        <OrbitRings />

        {/* Falling prime labels */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {streamItems.current.map((item, i) => (
            <FallingPrime key={i} {...item} />
          ))}
        </div>

        {/* Grid */}
        <div className="absolute inset-0 grid-bg opacity-20" />

        {/* Hero content */}
        <div className="relative z-10 text-center max-w-4xl mx-auto pt-20">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            {/* Badge */}
            <motion.div variants={fadeUp}>
              <span className="badge badge-indigo">
                <span className="status-dot w-1.5 h-1.5" />
                Active since 2026
              </span>
            </motion.div>

            {/* Main headline */}
            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-black leading-none tracking-tight">
              <span className="text-white">Hunting the</span>
              <br />
              <span className="text-gradient">52nd Mersenne Prime</span>
            </motion.h1>

            {/* Sub */}
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              The current world record is 2<sup>136,279,841</sup> − 1, confirmed in October 2024.
              This project runs Lucas-Lehmer on every candidate above that exponent, continuously,
              in your browser or on any machine that runs Node.
            </motion.p>

            {/* CTAs */}
            <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-4 pt-4">
              <motion.button
                onClick={startHunt}
                whileHover={{ scale: 1.04, boxShadow: "0 0 30px rgba(99,102,241,0.4)" }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary text-base px-6 py-3"
              >
                Start hunting now
              </motion.button>
              <motion.a
                href="#proof"
                whileHover={{ scale: 1.02 }}
                className="btn-ghost text-base px-6 py-3"
              >
                See the algorithm
              </motion.a>
            </motion.div>

            {/* Record pill */}
            <motion.div
              variants={fadeUp}
              className="inline-flex items-center gap-4 mt-6 px-5 py-3 rounded-xl card card-glow-amber"
            >
              <div className="text-left">
                <div className="text-xs text-zinc-500 uppercase tracking-widest">Current record</div>
                <div className="font-mono text-amber-400 font-bold text-sm mt-0.5">
                  2<sup>136,279,841</sup> − 1
                </div>
              </div>
              <div className="w-px h-8 bg-zinc-800" />
              <div className="text-left">
                <div className="text-xs text-zinc-500 uppercase tracking-widest">Digits</div>
                <div className="font-mono text-white font-bold text-sm mt-0.5">41,024,320</div>
              </div>
              <div className="w-px h-8 bg-zinc-800" />
              <div className="text-left">
                <div className="text-xs text-zinc-500 uppercase tracking-widest">Our target</div>
                <div className="font-mono text-indigo-400 font-bold text-sm mt-0.5">p &gt; 136,279,841</div>
              </div>
            </motion.div>
          </motion.div>

          {/* Scroll indicator */}
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute -bottom-16 left-1/2 -translate-x-1/2"
          >
            <svg width="20" height="28" viewBox="0 0 20 28" fill="none">
              <rect x="1" y="1" width="18" height="26" rx="9" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
              <motion.rect
                x="8.5" y="6" width="3" height="6" rx="1.5"
                fill="rgba(99,102,241,0.6)"
                animate={{ y: [0, 8, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </svg>
          </motion.div>
        </div>
      </motion.section>

      {/* ── STATS ────────────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-zinc-800/50">
        <div className="max-w-5xl mx-auto">
          <motion.div
            variants={staggerFast}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            {STATS.map((s, i) => (
              <motion.div key={i} variants={fadeUp}>
                <TiltCard className="p-5 h-full">
                  <div className="text-xs text-zinc-500 uppercase tracking-widest mb-2">{s.label}</div>
                  <div className={`font-mono text-2xl font-black mb-1 ${
                    s.accent === "indigo" ? "text-indigo-400" :
                    s.accent === "violet" ? "text-violet-400" :
                    s.accent === "sky"    ? "text-sky-400" : "text-amber-400"
                  }`}>
                    {s.value}
                  </div>
                  <div className="text-xs text-zinc-600">{s.unit}</div>
                </TiltCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── ALGORITHM PROOF ──────────────────────────────────── */}
      <AlgorithmProof />

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section id="proof" className="py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden" whileInView="show" viewport={{ once: true }}
            variants={stagger} className="mb-16"
          >
            <motion.div variants={fadeUp}>
              <span className="badge badge-indigo mb-6">Process</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-4">
              What happens, step by step.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-xl">
              No black box. Every stage is transparent and independently verifiable.
            </motion.p>
          </motion.div>

          <div className="space-y-3">
            {HOW_IT_WORKS.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.45 }}
              >
                <TiltCard className="p-6">
                  <div className="flex gap-5 items-start">
                    <div className="font-mono text-xs text-zinc-600 mt-1 shrink-0 w-6">{item.step}</div>
                    <div>
                      <h3 className="text-white font-semibold mb-1.5">{item.title}</h3>
                      <p className="text-zinc-400 text-sm leading-relaxed">{item.body}</p>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WORLD RECORD SECTION ─────────────────────────────── */}
      <section id="record" className="py-24 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden" whileInView="show" viewport={{ once: true }}
            variants={stagger} className="mb-16"
          >
            <motion.div variants={fadeUp}>
              <span className="badge badge-amber mb-6">World record</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-4">
              51 primes found over 2,300 years.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-xl">
              The gaps between discoveries tell the story of computing history. Each one required
              hardware that didn&apos;t exist a generation earlier.
            </motion.p>
          </motion.div>

          {/* Record card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="card card-glow-amber p-8 mb-10"
            style={{ border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-1">
                <div className="badge badge-amber mb-4">Guinness World Record</div>
                <h3 className="text-3xl font-black font-mono text-amber-400 mb-2">
                  2<sup>136,279,841</sup> − 1
                </h3>
                <p className="text-zinc-400 text-sm">
                  The 51st known Mersenne prime. Found by Luke Durant via GIMPS in October 2024.
                  41,024,320 digits — if you printed it, the stack would be 12 meters tall.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 shrink-0">
                {[
                  ["First 6 digits", "881..."],
                  ["Last 6 digits", "...551"],
                  ["Rank", "#51"],
                  ["Year", "2024"],
                ].map(([k, v]) => (
                  <div key={k} className="text-center">
                    <div className="text-xs text-zinc-600 mb-1">{k}</div>
                    <div className="font-mono text-white font-bold text-lg">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Timeline table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-zinc-800/50">
              <span className="text-xs text-zinc-500 uppercase tracking-widest">Discovery history (selected)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b border-zinc-800/50">
                    {["Rank", "Exponent (p)", "Digits", "Year", "Who"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-zinc-600 uppercase tracking-wider font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIMELINE.map((row, i) => (
                    <motion.tr
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.04 }}
                      className={`border-b border-zinc-800/30 transition-colors hover:bg-zinc-900/50 ${
                        row.isCurrent ? "bg-amber-950/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className={row.isCurrent ? "text-amber-400 font-bold" : "text-zinc-600"}>
                          #{row.rank}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={row.isCurrent ? "text-amber-400" : "text-indigo-400"}>
                          {row.exp.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={row.isCurrent ? "text-amber-300" : "text-zinc-300"}>
                          {row.digits.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{row.year}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{row.label}</td>
                    </motion.tr>
                  ))}
                  {/* Next row */}
                  <motion.tr
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="bg-indigo-950/20 border-b border-indigo-500/20"
                  >
                    <td className="px-4 py-3 text-indigo-400 font-bold">#52</td>
                    <td className="px-4 py-3">
                      <span className="text-indigo-300">
                        ???
                        <motion.span animate={{ opacity: [1,0,1] }} transition={{ duration: 1, repeat: Infinity }}>
                          _
                        </motion.span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-indigo-300">???</td>
                    <td className="px-4 py-3 text-indigo-400">2026 →</td>
                    <td className="px-4 py-3 text-indigo-400 text-xs">This project</td>
                  </motion.tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── LIVE HUNT ────────────────────────────────────────── */}
      <section id="hunt" className="py-24 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden" whileInView="show" viewport={{ once: true }}
            variants={stagger} className="mb-12"
          >
            <motion.div variants={fadeUp}>
              <span className="badge badge-indigo mb-6">Live computation</span>
            </motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold text-white mb-4">
              Running in your browser, right now.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-zinc-400 text-lg max-w-xl">
              This page uses a Web Worker to run Lucas-Lehmer in the background.
              It doesn&apos;t touch a server. The arithmetic happens in your tab
              using JavaScript&apos;s native BigInt.
            </motion.p>
          </motion.div>

          {/* Found primes alert */}
          <AnimatePresence>
            {found.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="mb-6 p-6 rounded-xl"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)" }}
              >
                <div className="text-amber-400 font-bold text-lg mb-2">New prime found.</div>
                {found.map((p, i) => (
                  <div key={i} className="font-mono text-sm text-zinc-300">
                    2<sup>{p.exponent.toLocaleString()}</sup> − 1
                    <span className="text-zinc-500 ml-3">({p.digits.toLocaleString()} digits)</span>
                  </div>
                ))}
                <div className="text-xs text-zinc-500 mt-3">
                  Submit to mersenne.org for independent verification.
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Main progress panel */}
            <div className="lg:col-span-2">
              <TiltCard className="p-6 h-full">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    {running && <span className="status-dot" />}
                    <span className="text-sm font-semibold text-zinc-300">
                      {running ? "Lucas-Lehmer running" : "Search paused"}
                    </span>
                  </div>
                  <motion.button
                    onClick={running ? stopHunt : startHunt}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      running
                        ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                        : "bg-indigo-600 text-white hover:bg-indigo-500"
                    }`}
                  >
                    {running ? "Pause" : "Resume"}
                  </motion.button>
                </div>

                {progress ? (
                  <div className="space-y-5">
                    {/* Current candidate */}
                    <div>
                      <div className="text-xs text-zinc-500 mb-1">Testing</div>
                      <div className="font-mono text-lg text-indigo-300 font-bold">
                        2<sup>{fmt(progress.exponent)}</sup> − 1
                        <span className="text-zinc-500 text-sm ml-3 font-normal">
                          {fmt(progress.digits)} digits
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div>
                      <div className="flex justify-between text-xs text-zinc-500 mb-2">
                        <span>Iteration {fmt(progress.iteration)} of {fmt(progress.total)}</span>
                        <span>{parseFloat(progress.percent).toFixed(4)}%</span>
                      </div>
                      <div className="progress-track">
                        <motion.div
                          className="progress-fill"
                          style={{ width: `${Math.min(parseFloat(progress.percent), 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Time grid */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        ["Elapsed",   fmtTime(progress.elapsed)],
                        ["ETA",       fmtTime(progress.eta)],
                        ["Rate",      `${progress.rate} iter/ms`],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-zinc-900/50 rounded-lg p-3">
                          <div className="text-xs text-zinc-600 mb-1">{k}</div>
                          <div className="font-mono text-white text-sm font-semibold">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    {running ? (
                      <div>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                          className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"
                        />
                        <div className="text-zinc-400 text-sm">Initializing worker...</div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-zinc-600 text-sm mb-4">
                          The search starts at p = 136,279,843 and moves upward,
                          one prime exponent at a time.
                        </div>
                        <button onClick={startHunt} className="btn-primary text-sm">
                          Start search
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </TiltCard>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Stats */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Session</div>
                <div className="space-y-3">
                  {[
                    ["Candidates tested",  fmt(totalTested)],
                    ["Running time",       fmtTime(uptime)],
                    ["New primes found",   found.length.toString()],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="text-zinc-500">{k}</span>
                      <span className="font-mono text-white font-semibold">{v}</span>
                    </div>
                  ))}
                </div>
              </TiltCard>

              {/* Log */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Log</div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {log.length === 0 ? (
                    <div className="text-xs text-zinc-700 font-mono">Waiting...</div>
                  ) : (
                    log.map((line, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`font-mono text-xs ${
                          line.includes("PRIME") ? "text-amber-400" :
                          line.includes("Composite") ? "text-zinc-600" : "text-zinc-400"
                        }`}
                      >
                        {line}
                      </motion.div>
                    ))
                  )}
                </div>
              </TiltCard>

              {/* 24/7 tip */}
              <TiltCard className="p-5">
                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">24/7 on any machine</div>
                <div className="font-mono text-xs text-zinc-400 space-y-1">
                  <div className="text-zinc-600">$ cd prime-hunter</div>
                  <div><span className="text-indigo-400">node</span> worker/prime-hunter.mjs</div>
                  <div className="text-zinc-600 text-[10px] mt-2">Progress saves every 30 seconds.</div>
                  <div className="text-zinc-600 text-[10px]">Resume anytime with the same command.</div>
                </div>
              </TiltCard>
            </div>
          </div>
        </div>
      </section>

      {/* ── HONEST CONTEXT ───────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-zinc-800/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                title: "What this actually is",
                body: "A real Lucas-Lehmer implementation searching above the current world record. The algorithm is correct. The computation is genuine. Whether we find anything depends on hardware and time.",
              },
              {
                title: "What this is not",
                body: "This is not affiliated with GIMPS. It doesn't use Prime95 or any optimized C/assembly. JavaScript BigInt is significantly slower than dedicated software — which is the point. It runs on anything.",
              },
              {
                title: "Realistic expectations",
                body: "Testing a single candidate at p = 136 million takes years on a laptop in JavaScript. For serious throughput, run Prime95 on the same machine. This project is about understanding the math, not winning the race.",
              },
            ].map((card, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <TiltCard className="p-6 h-full">
                  <h3 className="text-white font-semibold mb-3">{card.title}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">{card.body}</p>
                </TiltCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/50 py-12 px-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <LogoWordmark size={24} />
          <div className="text-center text-xs text-zinc-600 space-y-1">
            <div>Lucas-Lehmer algorithm — target: 52nd Mersenne prime (p &gt; 136,279,841)</div>
            <div>
              Found something?{" "}
              <a
                href="https://www.mersenne.org/report_prime/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Submit to GIMPS
              </a>
            </div>
          </div>
          <div className="flex gap-4">
            <motion.a
              href="https://github.com/nayrbryanGaming/antigravity-prime-hunter"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.05 }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              GitHub
            </motion.a>
            <motion.a
              href="https://www.mersenne.org"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.05 }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              GIMPS
            </motion.a>
          </div>
        </div>
      </footer>
    </div>
  );
}
