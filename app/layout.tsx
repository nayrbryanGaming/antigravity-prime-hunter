import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Antigravity Prime Hunter — Searching for the 52nd Mersenne Prime",
  description:
    "A Lucas-Lehmer search engine running 24 hours a day against Mersenne candidates " +
    "above the current world record exponent of 136,279,841. Open-source, browser-native, no server required.",
  keywords: [
    "Mersenne prime",
    "Lucas-Lehmer",
    "prime number",
    "world record",
    "GIMPS",
    "BigInt",
    "mathematics",
  ],
  openGraph: {
    title: "Antigravity Prime Hunter",
    description: "Searching for the 52nd Mersenne prime, candidate by candidate.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
