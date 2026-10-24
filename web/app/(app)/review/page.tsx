/**
 * /review - the held tasks, most urgent first.
 *
 * A worklist, not a control. Anyone may read it (held tasks are on the public docket
 * already); ruling on one needs an allowlisted reviewer wallet and happens on the task's
 * own page. See docs/dispute-design.md.
 *
 * "Most urgent" means the soonest the poster can reclaim: after that date a held task
 * can be refunded to the poster whatever the merit of the work, so it is the date a
 * reviewer is racing.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEMO_MODE, demoTasks, isSampleTask } from "@/lib/demo";
import { MetaRow } from "@/components/MetaRow";
import { formatRecordNumber } from "@/lib/task-id";
import { formatUsdc } from "@/lib/task-view";
import { isOperationalHold } from "@/lib/holds";
import { withoutSamples } from "@/lib/sample-data";
import { reclaimOpensAt } from "@/lib/held-copy";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

function currentTime(): Date {
  return new Date();
}

export default async function ReviewQueuePage() {
  let held: Array<{
    id: string;
    onchainTaskId: bigint;
    title: string;
    bountyAmount: bigint;
    deadline: Date;
    heldReason: string | null;
  }> = [];
  let dbReachable = true;

  try {
    if (DEMO_MODE) {
      held = demoTasks().filter((t) => t.state === "HELD");
    } else {
      held = await prisma.task.findMany({
        // Never a sample row on mainnet. See lib/sample-data.ts.
        where: withoutSamples({ state: "HELD" }),
        select: {
          id: true,
          onchainTaskId: true,
          title: true,
          bountyAmount: true,
          deadline: true,
          heldReason: true,
        },
        take: 100,
      });
    }
  } catch (error) {
    console.error("[review queue] database unreachable:", error);
    dbReachable = false;
  }

  held.sort((a, b) => reclaimOpensAt(a.deadline).getTime() - reclaimOpensAt(b.deadline).getTime());
  const now = currentTime();

  return (
    <article>
      <h1 className="page-title">Review queue</h1>
      <p className="page-lede">
        Held matters, most urgent first. Nothing here has been decided. A reviewer rules on a
        matter from its own page.
      </p>
      <p className="page-lede" style={{ marginTop: 8 }}>
        The date is when the poster can reclaim the bounty. After it, a held matter can be
        refunded whatever the merit of the work, so it is the date a reviewer is racing.
      </p>
      <hr className="rule" style={{ marginTop: 24 }} />

      <section style={{ marginTop: 24 }}>
        <div
          className="label"
          style={{
            display: "flex",
            gap: 16,
            paddingBottom: 10,
            borderBottom: "1px solid var(--border-strong)",
          }}
        >
          <span style={{ width: 56, flex: "0 0 56px" }}>Nº</span>
          <span style={{ flex: 1 }}>MATTER</span>
          <span style={{ width: 112, flex: "0 0 112px" }}>HELD BECAUSE</span>
          <span style={{ width: 88, flex: "0 0 88px", textAlign: "right" }}>BOUNTY</span>
          <span style={{ width: 128, flex: "0 0 128px", textAlign: "right" }}>RECLAIMABLE</span>
        </div>

        {!dbReachable && (
          <p style={{ fontSize: 15, color: "var(--text-muted)", padding: "24px 0" }}>
            The record store is unavailable. The chain is unaffected.
          </p>
        )}

        {dbReachable && held.length === 0 && (
          <p style={{ fontSize: 15, color: "var(--text-muted)", padding: "24px 0" }}>
            Nothing is held. Every submitted matter has been decided or is still being judged.
          </p>
        )}

        {held.map((task) => {
          const opens = reclaimOpensAt(task.deadline);
          return (
            <Link
              key={task.id}
              href={`/task/${task.id}`}
              className="record-row"
              style={{ gap: 16 }}
            >
              <span className="data" style={{ width: 56, flex: "0 0 56px", color: "var(--accent)", fontSize: 13 }}>
                {formatRecordNumber(task.onchainTaskId)}
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>
                {task.title}
                {isSampleTask(task.id) && (
                  <span className="label" style={{ color: "var(--warning)", marginLeft: 8 }}>
                    SAMPLE
                  </span>
                )}
              </span>
              {/* Operational: nothing was ruled on (an outage on our side). Judgement:
                  the judge looked and could not settle it. They need different people. */}
              <span className="label" style={{ width: 112, flex: "0 0 112px" }}>
                {isOperationalHold(task.heldReason) ? "OUTAGE" : "JUDGE UNSURE"}
              </span>
              <span className="data" style={{ width: 88, flex: "0 0 88px", textAlign: "right", fontSize: 13 }}>
                {formatUsdc(task.bountyAmount)}
              </span>
              <span
                className="data"
                style={{
                  width: 128,
                  flex: "0 0 128px",
                  textAlign: "right",
                  fontSize: 13,
                  color: now.getTime() > opens.getTime() ? "var(--negative)" : "var(--text-muted)",
                }}
              >
                {now.getTime() > opens.getTime() ? "NOW" : formatDate(opens)}
              </span>
            </Link>
          );
        })}
      </section>

      <MetaRow
        footnote="Ruling needs an allowlisted reviewer wallet. See docs/dispute-design.md."
        record="RECORD INDEX · REVIEW QUEUE"
      />
    </article>
  );
}
