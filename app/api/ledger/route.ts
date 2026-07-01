/**
 * /api/ledger — fast, read-only view of the persisted prime ledger.
 *
 * The landing page polls this every 30s to show what the Vercel Cron
 * job has computed and stored in Neon Postgres. Pure SELECT, no compute.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return NextResponse.json({ primes: [], totalFound: 0, totalTested: 0, runCount: 0,
        firstRun: null, lastRun: null, lastRunFound: 0, lastRunTested: 0, ratePerHour: 0,
        note: "DATABASE_URL not set" });
    }
    const sql = neon(url);

    // Tables may not exist yet before the first hunt run.
    const [meta] = await sql`
      SELECT
        (SELECT COUNT(*) FROM primes)                    AS total_found,
        (SELECT COALESCE(SUM(tested),0) FROM runs)       AS total_tested,
        (SELECT COUNT(*) FROM runs)                      AS run_count,
        (SELECT MIN(ran_at) FROM runs)                   AS first_run,
        (SELECT MAX(ran_at) FROM runs)                   AS last_run
    `.catch(() => [{ total_found: 0, total_tested: 0, run_count: 0, first_run: null, last_run: null }]);

    const recent = await sql`
      SELECT bits, digits, full_decimal, full_hex, found_at
      FROM primes ORDER BY id DESC LIMIT 20
    `.catch(() => []);

    const [lastRunRow] = await sql`
      SELECT tested, found FROM runs ORDER BY id DESC LIMIT 1
    `.catch(() => [{ tested: 0, found: 0 }]);

    return NextResponse.json({
      primes: recent.map((r: Record<string, unknown>) => ({
        bits: Number(r.bits),
        digits: Number(r.digits),
        decimal: String(r.full_decimal).slice(0, 30) + "…",
        fullDecimal: r.full_decimal,
        fullHex: r.full_hex,
        foundAt: r.found_at,
        runner: "vercel-cron",
      })),
      totalFound:   Number(meta?.total_found ?? 0),
      totalTested:  Number(meta?.total_tested ?? 0),
      runCount:     Number(meta?.run_count ?? 0),
      firstRun:     meta?.first_run ?? null,
      lastRun:      meta?.last_run ?? null,
      lastRunFound: Number(lastRunRow?.found ?? 0),
      lastRunTested:Number(lastRunRow?.tested ?? 0),
      ratePerHour:  0,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { primes: [], totalFound: 0, totalTested: 0, runCount: 0, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
