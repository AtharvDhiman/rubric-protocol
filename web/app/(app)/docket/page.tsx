/**
 * /docket — the record list.
 *
 * A ruled ledger, not a grid of cards. Rows are separated by 1px hairlines,
 * hover changes the background and nothing else, and every number is mono.
 * Filters are links rather than client state so the list works with JavaScript
 * disabled and each filter is a real URL.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEMO_MODE, demoTasks } from "@/lib/demo";
import { MetaRow } from "@/components/MetaRow";
import { Stamp, stampForState } from "@/components/Stamp";
import { formatUsdc } from "@/lib/task-view";
import { CATEGORIES } from "@/lib/constants";

export const dynamic = "force-dynamic";

function windowLabel(deadline: Date, state: string): string {
  if (state === "SETTLED" || state === "REFUNDED") return "closed";
  const ms = deadline.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function DocketPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const active = CATEGORIES.includes(category as never) ? category : undefined;

  let tasks: Awaited<ReturnType<typeof prisma.task.findMany>> = [];
  let totalEscrow = 0n;
  let verdictsToday = 0;
  let medianSeconds: number | null = null;
  let dbReachable = true;

  if (DEMO_MODE) {
    // No database configured at all. Serve the sample docket rather than an
    // error page, and say so above the table. See lib/demo.ts for why this is
    // gated on "not configured" and not on "unreachable".
    const all = demoTasks().filter(
      (task) => !active || task.category === active
    );
    tasks = all;
    totalEscrow = all
      .filter((task) => ["OPEN", "SUBMITTED", "HELD"].includes(task.state))
      .reduce((sum, task) => sum + task.bountyAmount, 0n);
    verdictsToday = all.filter((task) => task.state === "SETTLED" || task.state === "REFUNDED").length;
    const durations = all
      .filter((task) => task.decidedAt && task.submittedAt)
      .map((task) => (task.decidedAt!.getTime() - task.submittedAt!.getTime()) / 1000)
      .sort((a, b) => a - b);
    medianSeconds = durations.length
      ? Math.round(durations[Math.floor(durations.length / 2)])
      : null;
  } else
  try {
    const where = {
      state: { not: "PENDING" as const },
      ...(active ? { category: active } : {}),
    };

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [rows, escrowAgg, decidedToday, decided] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.task.aggregate({
        where: { state: { in: ["OPEN", "SUBMITTED", "HELD"] } },
        _sum: { bountyAmount: true },
      }),
      prisma.task.count({
        where: {
          state: { in: ["SETTLED", "REFUNDED"] },
          decidedAt: { gte: startOfDay },
        },
      }),
      prisma.task.findMany({
        where: {
          state: { in: ["SETTLED", "REFUNDED"] },
          decidedAt: { not: null },
          submittedAt: { not: null },
        },
        select: { decidedAt: true, submittedAt: true },
        take: 200,
      }),
    ]);

    tasks = rows;
    totalEscrow = escrowAgg._sum.bountyAmount ?? 0n;
    verdictsToday = decidedToday;

    const durations = decided
      .map((d) =>
        d.decidedAt && d.submittedAt
          ? (d.decidedAt.getTime() - d.submittedAt.getTime()) / 1000
          : null
      )
      .filter((v): v is number => v !== null && v >= 0)
      .sort((a, b) => a - b);
    if (durations.length > 0) {
      medianSeconds = Math.round(durations[Math.floor(durations.length / 2)]);
    }
  } catch (error) {
    console.error("[docket] database unreachable:", error);
    dbReachable = false;
  }

  const postedTotal = tasks.reduce((sum, t) => sum + t.bountyAmount, 0n);

  return (
    <article>
      {/* ---------------- HEADER ---------------- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="page-title">The docket</h1>
          <p className="page-lede">
            Open matters awaiting submission or verdict.
          </p>
        </div>
        <span className="label label-11">
          {tasks.length} {tasks.length === 1 ? "MATTER" : "MATTERS"} ·{" "}
          {formatUsdc(postedTotal)} USDC POSTED
        </span>
      </div>

      <hr className="rule" style={{ marginTop: 24 }} />

      {/* ---------------- FILTERS ---------------- */}
      <nav style={{ display: "flex", gap: 24, margin: "24px 0 8px", flexWrap: "wrap" }}>
        <FilterLink label="All" href="/docket" active={!active} />
        {CATEGORIES.map((c) => (
          <FilterLink
            key={c}
            label={c}
            href={`/docket?category=${c}`}
            active={active === c}
          />
        ))}
      </nav>

      <div
        className="app-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 240px",
          gap: 32,
          marginTop: 24,
          alignItems: "start",
        }}
      >
        {/* ---------------- THE LEDGER ---------------- */}
        <section>
          <div
            className="label docket-head"
            style={{
              display: "flex",
              gap: 16,
              paddingBottom: 10,
              borderBottom: "1px solid var(--border-strong)",
            }}
          >
            <span style={{ width: 56, flex: "0 0 56px" }}>Nº</span>
            <span style={{ flex: 1 }}>MATTER</span>
            <span style={{ width: 72, flex: "0 0 72px" }}>CLAUSES</span>
            <span style={{ width: 96, flex: "0 0 96px", textAlign: "right" }}>
              BOUNTY
            </span>
            <span style={{ width: 88, flex: "0 0 88px", textAlign: "right" }}>
              WINDOW
            </span>
            <span style={{ width: 120, flex: "0 0 120px", textAlign: "right" }}>
              STATUS
            </span>
          </div>

          {!dbReachable && (
            <p style={{ fontSize: 15, color: "var(--text-muted)", padding: "24px 0" }}>
              The record store is unavailable. The chain is unaffected — nothing
              about escrow depends on this database.
            </p>
          )}

          {dbReachable && tasks.length === 0 && (
            <p style={{ fontSize: 15, color: "var(--text-muted)", padding: "24px 0" }}>
              No open matters. The docket is clear.{" "}
              <Link href="/create" style={{ color: "var(--accent)" }}>
                Draft a rubric
              </Link>
              .
            </p>
          )}

          {tasks.map((task) => (
            <Link
              key={task.id}
              href={`/task/${task.id}`}
              className="record-row"
              style={{ gap: 16 }}
            >
              <span
                className="data"
                style={{
                  width: 56,
                  flex: "0 0 56px",
                  color: "var(--accent)",
                  fontSize: 13,
                }}
              >
                {task.onchainTaskId.toString().padStart(4, "0")}
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>
                {task.title}
              </span>
              <span
                className="data"
                style={{ width: 72, flex: "0 0 72px", fontSize: 13 }}
              >
                {task.clauses.length}
              </span>
              <span
                className="data"
                style={{
                  width: 96,
                  flex: "0 0 96px",
                  textAlign: "right",
                  fontSize: 13,
                }}
              >
                {formatUsdc(task.bountyAmount)}
              </span>
              <span
                className="data"
                style={{
                  width: 88,
                  flex: "0 0 88px",
                  textAlign: "right",
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                {windowLabel(task.deadline, task.state)}
              </span>
              <span
                style={{
                  width: 120,
                  flex: "0 0 120px",
                  textAlign: "right",
                }}
              >
                <Stamp variant={stampForState(task.state)} small />
              </span>
            </Link>
          ))}
        </section>

        {/* ---------------- RIGHT RAIL ---------------- */}
        <aside
          style={{
            borderLeft: "1px solid var(--border)",
            paddingLeft: 32,
          }}
        >
          <Figure label="TOTAL IN ESCROW" value={`${formatUsdc(totalEscrow)}`} />
          <Figure label="VERDICTS TODAY" value={String(verdictsToday)} />
          <Figure
            label="MEDIAN TIME TO VERDICT"
            value={medianSeconds === null ? "—" : `${medianSeconds}s`}
            accent="var(--positive)"
            last
          />
        </aside>
      </div>

      <MetaRow
        footnote="Bounties denominated in USDC."
        record="RECORD INDEX · THE DOCKET"
      />
    </article>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      style={{
        fontSize: 14,
        textDecoration: "none",
        color: active ? "var(--text)" : "var(--text-muted)",
        paddingBottom: 4,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
      }}
    >
      {label}
    </Link>
  );
}

function Figure({
  label,
  value,
  accent,
  last = false,
}: {
  label: string;
  value: string;
  accent?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        paddingBottom: 20,
        marginBottom: last ? 0 : 20,
        borderBottom: last ? "none" : "1px solid var(--hairline)",
      }}
    >
      <div className="label">{label}</div>
      <div
        className="data"
        style={{
          fontSize: 24,
          fontWeight: 600,
          marginTop: 6,
          color: accent ?? "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
