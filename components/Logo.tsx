"use client";

import { motion } from "framer-motion";

interface LogoProps {
  size?: number;
  animated?: boolean;
}

export function Logo({ size = 36, animated = true }: LogoProps) {
  const Wrap = animated ? motion.svg : "svg";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Antigravity Prime Hunter"
    >
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient id="g2" x1="40" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer ring — orbit path */}
      <motion.circle
        cx="20"
        cy="20"
        r="18"
        stroke="url(#g1)"
        strokeWidth="0.8"
        strokeDasharray="4 3"
        fill="none"
        opacity="0.4"
        animate={animated ? { rotate: 360 } : undefined}
        style={{ originX: "20px", originY: "20px" }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
      />

      {/* Inner orbital ring — tilted 60deg */}
      <motion.ellipse
        cx="20"
        cy="20"
        rx="13"
        ry="5"
        stroke="url(#g2)"
        strokeWidth="0.7"
        fill="none"
        opacity="0.35"
        transform="rotate(-35 20 20)"
        animate={animated ? { rotate: [-35, 325] } : undefined}
        style={{ originX: "20px", originY: "20px" }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
      />

      {/* Center hexagon */}
      <path
        d="M20 8 L29.2 13.5 L29.2 26.5 L20 32 L10.8 26.5 L10.8 13.5 Z"
        fill="#09090b"
        stroke="url(#g1)"
        strokeWidth="0.9"
      />

      {/* The P letterform — custom geometric */}
      <path
        d="M15 14 L15 26 M15 14 L20 14 Q24 14 24 17.5 Q24 21 20 21 L15 21"
        stroke="url(#g1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glow)"
      />

      {/* Orbiting dot — proof the hunt is active */}
      <motion.circle
        cx="38"
        cy="20"
        r="2.5"
        fill="#6366f1"
        filter="url(#glow)"
        animate={animated ? {
          cx: [38, 20, 2, 20, 38],
          cy: [20, 2, 20, 38, 20],
        } : undefined}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
      />

      {/* Prime gap indicator — the 4 vertices */}
      {[0, 60, 120, 180, 240, 300].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const x = 20 + 18 * Math.cos(rad);
        const y = 20 + 18 * Math.sin(rad);
        // Only show prime-indexed vertices (primes: 2,3,5 → indices 0,1,2,4)
        const show = [0, 1, 2, 4].includes(i);
        return show ? (
          <motion.circle
            key={deg}
            cx={x}
            cy={y}
            r="1.8"
            fill="url(#g2)"
            opacity="0.9"
            animate={animated ? { opacity: [0.9, 0.3, 0.9] } : undefined}
            transition={{
              duration: 2,
              repeat: Infinity,
              delay: i * 0.4,
              ease: "easeInOut",
            }}
          />
        ) : (
          <circle key={deg} cx={x} cy={y} r="0.8" fill="#3f3f46" opacity="0.4" />
        );
      })}
    </svg>
  );
}

export function LogoWordmark({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={size} />
      <div>
        <div className="text-sm font-bold tracking-tight text-white leading-none">
          Antigravity
        </div>
        <div className="text-xs text-zinc-500 tracking-widest uppercase leading-tight">
          Prime Hunter
        </div>
      </div>
    </div>
  );
}
