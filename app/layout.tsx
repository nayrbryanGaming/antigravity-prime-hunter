import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANTIGRAVITY PRIME HUNTER — Guinness World Record Attempt",
  description:
    "24/7 autonomous Mersenne prime search engine. Lucas-Lehmer algorithm. " +
    "Targeting the 52nd Mersenne prime, surpassing 2^136,279,841 - 1 (current world record, Oct 2024).",
  keywords: ["prime numbers", "Mersenne prime", "Lucas-Lehmer", "world record", "GIMPS", "mathematics"],
  openGraph: {
    title: "ANTIGRAVITY PRIME HUNTER",
    description: "Hunting the world's largest prime number 24/7",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
