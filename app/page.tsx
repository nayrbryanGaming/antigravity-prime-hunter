"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────
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

interface FoundPrime {
  exponent: number;
  digits: number;
  foundAt: string;
}

interface WorkerStatus {
  status: "testing" | "idle" | "running";
  exponent: number | null;
  digits?: number;
  tested: number;
  found: number;
  uptime: number;
  iterations?: number;
}

// ── Constants ─────────────────────────────────────────────────────
const KNOWN_MERSENNE = [
  { rank: 1, exp: 2, digits: 1, year: "Ancient" },
  { rank: 2, exp: 3, digits: 1, year: "Ancient" },
  { rank: 3, exp: 5, digits: 2, year: "Ancient" },
  { rank: 4, exp: 7, digits: 3, year: "Ancient" },
  { rank: 5, exp: 13, digits: 4, year: "1461" },
  { rank: 10, exp: 89, digits: 27, year: "1911" },
  { rank: 20, exp: 4423, digits: 1332, year: "1961" },
  { rank: 30, exp: 132049, digits: 39751, year: "1983" },
  { rank: 40, exp: 20996011, digits: 6320430, year: "2003" },
  { rank: 45, exp: 37156667, digits: 11185272, year: "2008" },
  { rank: 48, exp: 57885161, digits: 17425170, year: "2013" },
  { rank: 49, exp: 74207281, digits: 22338618, year: "2016" },
  { rank: 50, exp: 77232917, digits: 23249425, year: "2018" },
  { rank: 51, exp: 82589933, digits: 24862048, year: "2018" },
  { rank: "51★", exp: 136279841, digits: 41024320, year: "2024 ← RECORD", isCurrent: true },
];

// ── Utility functions ─────────────────────────────────────────────
function formatNum(n: number): string {
  return n.toLocaleString("id-ID");
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} menit`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} jam`;
  return `${(ms / 86_400_000).toFixed(1)} hari`;
}

function mersenneDigits(p: number): number {
  return Math.floor(p * Math.log10(2)) + 1;
}

// ── Main component ────────────────────────────────────────────────
export default function PrimeHunterDashboard() {
  const workerRef = useRef<Worker | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<WorkerProgress | null>(null);
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [foundPrimes, setFoundPrimes] = useState<FoundPrime[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [uptime, setUptime] = useState(0);
  const uptimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const [startExp, setStartExp] = useState(136_279_843);
  const [totalTested, setTotalTested] = useState(0);
  const [totalIterations, setTotalIterations] = useState(0);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("id-ID");
    setLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (uptimeRef.current) clearInterval(uptimeRef.current);
    };
  }, []);

  const startHunting = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = new Worker("/prime-worker.js");
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, data } = e.data;

      switch (type) {
        case "PROGRESS":
          setProgress(data);
          setTotalIterations((n) => n + 500);
          break;

        case "STATUS":
          setStatus(data);
          if (data.tested) setTotalTested(data.tested);
          break;

        case "RESULT":
          addLog(
            `✗ 2^${formatNum(data.exponent)} - 1 adalah KOMPOSIT (${formatNum(data.digits)} digit)`
          );
          break;

        case "FOUND":
          setFoundPrimes((prev) => [data, ...prev]);
          addLog(
            `🏆 PRIMA BARU DITEMUKAN! 2^${formatNum(data.exponent)} - 1 (${formatNum(data.digits)} digit)`
          );
          break;
      }
    };

    worker.onerror = (e) => {
      addLog(`⚠️ Worker error: ${e.message}`);
    };

    worker.postMessage({ type: "START", exponent: startExp });
    setRunning(true);
    startTimeRef.current = Date.now();
    addLog(`▶ Memulai pencarian dari p = ${formatNum(startExp)}`);
    addLog(`▶ Target: menemukan prima Mersenne ke-52 (p > 136,279,841)`);

    uptimeRef.current = setInterval(() => {
      setUptime(Date.now() - startTimeRef.current);
    }, 1000);
  }, [startExp, addLog]);

  const stopHunting = useCallback(() => {
    workerRef.current?.postMessage({ type: "STOP" });
    setTimeout(() => {
      workerRef.current?.terminate();
      workerRef.current = null;
    }, 500);
    setRunning(false);
    if (uptimeRef.current) clearInterval(uptimeRef.current);
    addLog("⏸ Pencarian dihentikan.");
  }, [addLog]);

  const currentDigits = progress?.digits ?? mersenneDigits(startExp);
  const progressPct = parseFloat(progress?.percent ?? "0");

  return (
    <div className="relative min-h-screen z-10">
      {/* Header */}
      <header className="glass border-b border-[rgba(14,165,233,0.2)] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-blue-500 opacity-30 absolute inset-0 ping-slow" />
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-sm font-bold relative">
                π
              </div>
            </div>
            <div>
              <h1 className="font-bold text-sm gradient-text tracking-widest uppercase">
                Antigravity Prime Hunter
              </h1>
              <p className="text-[10px] text-slate-500 font-mono">
                Lucas-Lehmer Mersenne Search Engine v1.0
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {running && (
              <div className="flex items-center gap-2 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                AKTIF · {formatTime(uptime)}
              </div>
            )}
            <button
              onClick={running ? stopHunting : startHunting}
              className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${
                running
                  ? "bg-red-900/50 border border-red-500/50 text-red-400 hover:bg-red-800/50"
                  : "bg-blue-600 hover:bg-blue-500 text-white glow-blue"
              }`}
            >
              {running ? "⏹ STOP" : "▶ MULAI BERBURU"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Hero — World Record Context */}
        <div className="glass rounded-xl p-6 glow-gold border border-yellow-500/20">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1">
              <div className="record-badge inline-block px-3 py-1 rounded-full text-xs font-bold text-black mb-3">
                🏆 GUINNESS WORLD RECORD — PRIMA TERBESAR SAAT INI
              </div>
              <h2 className="text-2xl font-bold font-mono text-yellow-400 mb-1">
                2<sup>136,279,841</sup> − 1
              </h2>
              <p className="text-slate-400 text-sm mb-2">
                Prima Mersenne ke-51 · Ditemukan Oktober 2024 oleh GIMPS
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <div className="text-slate-500 text-xs">JUMLAH DIGIT</div>
                  <div className="text-yellow-400 font-mono font-bold text-lg">41,024,320</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">EKSPONENT</div>
                  <div className="text-yellow-400 font-mono font-bold text-lg">136,279,841</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs">TARGET KITA</div>
                  <div className="text-blue-400 font-mono font-bold text-lg">Prima ke-52 →</div>
                </div>
              </div>
            </div>
            <div className="text-right text-xs text-slate-500 font-mono space-y-1">
              <div>3 digit pertama: <span className="text-white">881...</span></div>
              <div>3 digit terakhir: <span className="text-white">...551</span></div>
              <div>Algoritma: <span className="text-blue-400">Lucas-Lehmer</span></div>
              <div>Verifikasi: <span className="text-green-400">✓ Independent</span></div>
            </div>
          </div>
        </div>

        {/* Live Status Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "EKSPONENT SAAT INI",
              value: progress ? formatNum(progress.exponent) : formatNum(startExp),
              sub: `2^p - 1`,
              color: "text-blue-400",
            },
            {
              label: "JUMLAH DIGIT",
              value: formatNum(currentDigits),
              sub: currentDigits >= 41_024_320 ? "🏆 REKOR!" : `${((currentDigits / 41_024_320) * 100).toFixed(1)}% dari rekor`,
              color: currentDigits >= 41_024_320 ? "text-yellow-400" : "text-cyan-400",
            },
            {
              label: "TOTAL DIUJI",
              value: formatNum(totalTested),
              sub: "kandidat Mersenne",
              color: "text-purple-400",
            },
            {
              label: "PRIMA DITEMUKAN",
              value: foundPrimes.length.toString(),
              sub: foundPrimes.length > 0 ? "🎉 REKOR BARU!" : "belum ada (tetap semangat!)",
              color: foundPrimes.length > 0 ? "text-yellow-400" : "text-slate-400",
            },
          ].map((stat, i) => (
            <div key={i} className="glass rounded-xl p-4">
              <div className="text-[10px] text-slate-500 tracking-widest mb-1">{stat.label}</div>
              <div className={`text-xl font-mono font-bold ${stat.color} mb-1 truncate`}>
                {stat.value}
              </div>
              <div className="text-[10px] text-slate-500">{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Main computation panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Lucas-Lehmer Progress */}
          <div className="lg:col-span-2 glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                LUCAS-LEHMER TEST AKTIF
              </h3>
              {progress && (
                <span className="text-xs text-slate-500 font-mono">
                  {progress.rate} iter/ms
                </span>
              )}
            </div>

            {progress ? (
              <>
                <div className="font-mono text-sm mb-3">
                  <span className="text-slate-500">Menguji: </span>
                  <span className="text-blue-400">2^</span>
                  <span className="text-white font-bold">{formatNum(progress.exponent)}</span>
                  <span className="text-blue-400"> − 1</span>
                  <span className="text-slate-500 ml-2">({formatNum(progress.digits)} digit)</span>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Iterasi {formatNum(progress.iteration)} / {formatNum(progress.total)}</span>
                    <span>{progress.percent}%</span>
                  </div>
                  <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full progress-bar rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(progressPct, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-900/50 rounded p-2">
                    <div className="text-slate-500">Waktu berjalan</div>
                    <div className="text-white font-mono">{formatTime(progress.elapsed)}</div>
                  </div>
                  <div className="bg-slate-900/50 rounded p-2">
                    <div className="text-slate-500">Estimasi selesai</div>
                    <div className="text-white font-mono">{formatTime(progress.eta)}</div>
                  </div>
                  <div className="bg-slate-900/50 rounded p-2">
                    <div className="text-slate-500">Browser uptime</div>
                    <div className="text-green-400 font-mono">{formatTime(uptime)}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                {running ? (
                  <div>
                    <div className="text-blue-400 text-lg mb-2">⚡ Mempersiapkan...</div>
                    <div className="text-slate-500 text-sm">Worker sedang diinisialisasi</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-4xl mb-3">🔭</div>
                    <div className="text-slate-400 mb-4">
                      Klik <strong className="text-blue-400">MULAI BERBURU</strong> untuk memulai
                      <br />pencarian prima Mersenne ke-52 di browser ini
                    </div>
                    <div className="text-xs text-slate-600 font-mono">
                      Start exponent: p = {formatNum(startExp)}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      = 2^{formatNum(startExp)} - 1 ({formatNum(mersenneDigits(startExp))} digit)
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info Panel */}
          <div className="space-y-4">
            <div className="glass rounded-xl p-4">
              <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3">
                KENAPA MERSENNE PRIMES?
              </h3>
              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex gap-2">
                  <span className="text-blue-400">✦</span>
                  <span>Semua 10 prima terbesar dunia adalah Mersenne primes</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400">✦</span>
                  <span>Lucas-Lehmer adalah satu-satunya tes pasti dan efisien</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400">✦</span>
                  <span>Hadiah $3,000 untuk prima 100M+ digit (EFF)</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-blue-400">✦</span>
                  <span>Hadiah $150,000 untuk prima 1 MILIAR digit!</span>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-4">
              <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3">
                CARA KERJA LUCAS-LEHMER
              </h3>
              <div className="font-mono text-xs space-y-1 text-slate-400">
                <div><span className="text-blue-400">M_p</span> = 2^p − 1</div>
                <div><span className="text-cyan-400">s₀</span> = 4</div>
                <div><span className="text-cyan-400">sᵢ</span> = (sᵢ₋₁² − 2) mod M_p</div>
                <div className="mt-2 pt-2 border-t border-slate-700">
                  Jika <span className="text-green-400">s_{"{p-2}"}</span> = 0
                  <br />→ <span className="text-yellow-400">M_p PRIMA!</span> 🏆
                </div>
              </div>
            </div>

            {/* Start exponent config */}
            {!running && (
              <div className="glass rounded-xl p-4">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest mb-3">
                  KONFIGURASI START
                </h3>
                <div className="text-xs text-slate-500 mb-2">Eksponent awal (harus prima):</div>
                <select
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  value={startExp}
                  onChange={(e) => setStartExp(Number(e.target.value))}
                >
                  <option value={136_279_843}>136,279,843 (setelah rekor, lambat)</option>
                  <option value={10_000_019}>10,000,019 (menengah)</option>
                  <option value={1_000_003}>1,000,003 (cepat untuk tes)</option>
                  <option value={100_003}>100,003 (super cepat)</option>
                  <option value={9689}>9,689 (verifikasi algoritma)</option>
                </select>
                <p className="text-[10px] text-slate-600 mt-2">
                  Tip: Mulai dari 100,003 untuk lihat algoritma bekerja, lalu switch ke 136,279,843 untuk hunt rekor sungguhan.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Found primes section */}
        {foundPrimes.length > 0 && (
          <div className="glass rounded-xl p-5 glow-gold border border-yellow-500/30">
            <h3 className="text-sm font-bold text-yellow-400 mb-4">
              🏆 PRIMA MERSENNE BARU DITEMUKAN!
            </h3>
            {foundPrimes.map((p, i) => (
              <div key={i} className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4 mb-3">
                <div className="text-xl font-mono font-bold text-yellow-400 mb-1">
                  2^{formatNum(p.exponent)} − 1
                </div>
                <div className="text-sm text-slate-400">
                  {formatNum(p.digits)} digit · Ditemukan {new Date(p.foundAt).toLocaleString("id-ID")}
                </div>
                <div className="mt-3 text-xs text-yellow-300">
                  ⚡ SEGERA submit ke: https://www.mersenne.org/report_prime/
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Known Mersenne Primes Timeline */}
        <div className="glass rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-300 mb-4">
            SEJARAH PRIMA MERSENNE — Menuju Rekor Ke-52
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left py-2 pr-4">Peringkat</th>
                  <th className="text-left py-2 pr-4">Eksponent (p)</th>
                  <th className="text-left py-2 pr-4">Digit</th>
                  <th className="text-left py-2">Tahun</th>
                </tr>
              </thead>
              <tbody>
                {KNOWN_MERSENNE.map((m, i) => (
                  <tr
                    key={i}
                    className={`border-b border-slate-800/50 ${
                      m.isCurrent ? "bg-yellow-900/20" : "hover:bg-slate-800/30"
                    }`}
                  >
                    <td className="py-1.5 pr-4">
                      <span className={m.isCurrent ? "text-yellow-400 font-bold" : "text-slate-500"}>
                        #{m.rank}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className={m.isCurrent ? "text-yellow-400" : "text-blue-400"}>
                        2^{formatNum(m.exp)} − 1
                      </span>
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className={m.isCurrent ? "text-yellow-400" : "text-slate-300"}>
                        {formatNum(m.digits)}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span className={m.isCurrent ? "text-yellow-400 font-bold" : "text-slate-500"}>
                        {m.year}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-blue-500/30 bg-blue-900/20">
                  <td className="py-2 pr-4">
                    <span className="text-blue-400 font-bold">#52 ← KITA</span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="text-blue-400 cursor-blink">
                      2^??? − 1
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="text-blue-400">???</span>
                  </td>
                  <td className="py-2">
                    <span className="text-blue-400">2026 → ?</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity log */}
        <div className="glass rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-300 mb-3">LOG AKTIVITAS</h3>
          <div className="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
            {log.length === 0 ? (
              <div className="text-slate-600">Belum ada aktivitas. Klik MULAI BERBURU!</div>
            ) : (
              log.map((line, i) => (
                <div
                  key={i}
                  className={`${
                    line.includes("PRIMA BARU")
                      ? "text-yellow-400"
                      : line.includes("▶")
                      ? "text-blue-400"
                      : line.includes("✗")
                      ? "text-slate-500"
                      : "text-slate-400"
                  }`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-600 pb-6 space-y-1">
          <div>
            Antigravity Prime Hunter — Tugas Kuliah × Guinness World Record Attempt
          </div>
          <div>
            Algoritma: Lucas-Lehmer Test · Target: Prima Mersenne ke-52 (p &gt; 136,279,841)
          </div>
          <div>
            Untuk komputasi 24/7 non-stop:{" "}
            <code className="text-blue-400">node worker/prime-hunter.mjs</code>
          </div>
          <div className="text-slate-700">
            Built with Next.js · Browser Web Workers · BigInt arithmetic
          </div>
        </div>
      </main>
    </div>
  );
}
