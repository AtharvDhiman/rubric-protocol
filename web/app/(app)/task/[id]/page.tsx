/**
 * /task/[id] — the verdict sheet.
 *
 * The screen the whole product is for: the sealed clauses on the left, what was
 * delivered and how it was judged on the right, and a receipt at the bottom.
 * Everything a person might want to check themselves — the PDA, the clause
 * hash, the transaction signature — is in Plex Mono and copyable.
 */

import Link from "next/link";
import { prisma } from "@/lib/db";
import { ClauseList } from "@/components/ClauseList";
import { MetaRow } from "@/components/MetaRow";
import { Stamp } from "@/components/Stamp";
import { CopyButton } from "@/components/CopyButton";
import { SubmitWorkPanel } from "./SubmitWorkPanel";
import { explorerTxUrl } from "@/lib/env";
import {
  formatUsdc,

  taskPdaSafe,
  truncateAddress,
  truncateHash,
} from "@/lib/task-view";

export const dynamic = "force-dynamic";

/**
 * Module scope on purpose: reading the clock inside a component body is flagged
 * as impure, and this is a server component where the value is resolved once
 * per request anyway.
 */
function windowHasClosed(deadline: Date): boolean {
  return deadline.getTime() <= Date.now();
}

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

function formatDateTime(date: Date): string {
  const d = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const t = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${d}, ${t} UTC`;
}

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let task = null;
  let dbReachable = true;
  try {
    task = await prisma.task.findUnique({ where: { id } });
  } catch (error) {
    console.error("[task page] database unreachable:", error);
    dbReachable = false;
  }

  if (!dbReachable) {
    return (
      <Empty
        heading="The record store is unavailable"
        body="The chain is unaffected — no task state or escrow depends on this database. Try again shortly."
      />
    );
  }

  if (!task || task.state === "PENDING") {
    return (
      <Empty
        heading="No such matter"
        body="This record does not exist, or its funding transaction never confirmed."
      />
    );
  }

  const recordNumber = task.onchainTaskId.toString().padStart(4, "0");
  const verdict = task.verdictJson as null | {
    approved: boolean;
    confidence: number;
    summary: string;
    clauses: Array<{ index: number; passed: boolean; reason: string }>;
  };

  const pda = taskPdaSafe(task.creatorAddress, task.onchainTaskId);
  const settled = task.state === "SETTLED";
  const refunded = task.state === "REFUNDED";
  const held = task.state === "HELD";
  const decided = settled || refunded;
  const windowClosed = windowHasClosed(task.deadline);

  return (
    <article>
      {/* ---------------- HEADER ---------------- */}
      <p className="label label-11" style={{ margin: 0 }}>
        MATTER Nº {recordNumber} · {task.category.toUpperCase()} · OPENED{" "}
        {formatDate(task.createdAt)}
      </p>

<h1 className="page-title" style={{ margin: "12px 0 0" }}>
        {task.title}
      </h1>

      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          margin: "16px 0 24px",
        }}
      >
        <span className="label">
          POSTED BY{" "}
          <span className="data" style={{ color: "var(--text)" }}>
            {truncateAddress(task.creatorAddress)}
          </span>
        </span>
        <span className="label">
          ESCROW{" "}
          <span className="data" style={{ color: "var(--text)" }}>
            {formatUsdc(task.bountyAmount)} USDC
          </span>
        </span>
        <span className="label">
          {decided && task.decidedAt && task.submittedAt
            ? `VERDICT IN ${Math.max(
                1,
                Math.round(
                  (task.decidedAt.getTime() - task.submittedAt.getTime()) / 1000
                )
              )}s`
            : `WINDOW CLOSES ${formatDate(task.deadline)}`}
        </span>
      </div>

      <hr className="rule" />

      {/* ---------------- TWO COLUMNS ---------------- */}
      <div
        className="app-two-col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 40,
          marginTop: 32,
          alignItems: "start",
        }}
      >
        {/* ---- LEFT: the sealed rubric ---- */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <h2 className="label label-accent" style={{ fontSize: 10 }}>
              SEALED CLAUSES
            </h2>
            <Stamp variant="sealed" small />
          </div>

          <ClauseList clauses={task.clauses} />

          <dl
            style={{
              margin: "32px 0 0",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "10px 24px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          >
            <dt style={{ color: "var(--text-muted)" }}>PDA</dt>
            <dd style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              <span>{pda ? truncateAddress(pda, 6, 4) : "—"}</span>
              {pda && <CopyButton value={pda} />}
            </dd>

            <dt style={{ color: "var(--text-muted)" }}>CLAUSE HASH</dt>
            <dd style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              <span>{truncateHash(task.rubricHash)}</span>
              <CopyButton value={task.rubricHash} />
            </dd>

            <dt style={{ color: "var(--text-muted)" }}>SEALED</dt>
            <dd style={{ margin: 0 }}>{formatDateTime(task.createdAt)}</dd>

            {task.txCreate && (
              <>
                <dt style={{ color: "var(--text-muted)" }}>FUNDING TX</dt>
                <dd style={{ margin: 0 }}>
                  <a
                    href={explorerTxUrl(task.txCreate)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                  >
                    {truncateAddress(task.txCreate, 6, 6)}
                  </a>
                </dd>
              </>
            )}
          </dl>

          <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 24 }}>
            These clauses cannot be edited after sealing — not by the poster, not
            by the protocol.
          </p>
        </section>

        {/* ---- RIGHT: submission and verdict ---- */}
        <section
          style={{
            borderLeft: "1px solid var(--border)",
            paddingLeft: 40,
          }}
        >
          <h2 className="label" style={{ fontSize: 10, marginBottom: 12 }}>
            SUBMISSION
          </h2>

          {task.submissionContent ? (
            <div
              style={{
                border: "1px solid var(--hairline)",
                borderRadius: 2,
                padding: "16px 20px",
                background: "var(--raised)",
              }}
            >
              <div className="data" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {task.workerAddress
                  ? truncateAddress(task.workerAddress)
                  : "unclaimed"}
              </div>
              <p
                style={{
                  fontSize: 15,
                  margin: "10px 0 12px",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {task.submissionContent.length > 900
                  ? `${task.submissionContent.slice(0, 900)}…`
                  : task.submissionContent}
              </p>
              {task.submissionHash && (
                <div className="data" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {truncateHash(task.submissionHash)}
                </div>
              )}
            </div>
          ) : (
            <SubmitWorkPanel
              taskId={task.id}
              closed={windowClosed}
            />
          )}

          {/* ---- The verdict ---- */}
          {task.state === "SUBMITTED" && (
            <div style={{ marginTop: 32 }}>
              <Stamp variant="inReview" />
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 16 }}>
                The judge is reading this submission against the sealed clauses.
                Nothing moves until it has ruled on every one of them.
              </p>
            </div>
          )}

          {held && (
            <div style={{ marginTop: 32 }}>
              <Stamp variant="held" />
              <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 16 }}>
                The judge was not confident enough to settle this automatically,
                so the escrow is untouched and a person will review it. Nobody has
                been paid and nobody has been refunded.
              </p>
              {task.heldReason && (
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--warning)",
                    marginTop: 8,
                  }}
                >
                  {task.heldReason}
                </p>
              )}
            </div>
          )}

          {verdict && (
            <div style={{ marginTop: 32 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  marginBottom: 20,
                }}
              >
                <Stamp variant={verdict.approved ? "approved" : "rejected"} />
                <div>
                  <div className="label">CONFIDENCE</div>
                  <div
                    className="data"
                    style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}
                  >
                    {verdict.confidence}
                  </div>
                </div>
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <caption className="sr-only">Per-clause ruling</caption>
                <tbody>
                  {verdict.clauses.map((ruling) => (
                    <tr
                      key={ruling.index}
                      style={{ borderBottom: "1px solid var(--hairline)" }}
                    >
                      <td
                        className="clause-mark"
                        style={{
                          padding: "12px 12px 12px 0",
                          verticalAlign: "top",
                          width: 34,
                          fontSize: 13,
                        }}
                      >
                        §{ruling.index + 1}
                      </td>
                      <td
                        style={{
                          padding: "12px 0",
                          color: "var(--text-2)",
                          verticalAlign: "top",
                        }}
                      >
                        {ruling.reason}
                      </td>
                      <td
                        className="data"
                        style={{
                          padding: "12px 0 12px 16px",
                          textAlign: "right",
                          verticalAlign: "top",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: ruling.passed
                            ? "var(--positive)"
                            : "var(--negative)",
                        }}
                      >
                        {ruling.passed ? "PASS" : "FAIL"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {verdict.summary && (
                <p style={{ fontSize: 14, color: "var(--text-2)", marginTop: 20 }}>
                  {verdict.summary}
                </p>
              )}

              {/* ---- The receipt ---- */}
              {decided && (
                <div
                  style={{
                    marginTop: 28,
                    background: "var(--raised)",
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 24,
                  }}
                >
                  <div>
                    <div
                      className="label"
                      style={{
                        color: settled ? "var(--positive)" : "var(--negative)",
                      }}
                    >
                      {settled ? "RELEASED FROM ESCROW" : "RETURNED TO POSTER"}
                    </div>
                    {task.txSettle && (
                      <a
                        className="data"
                        href={explorerTxUrl(task.txSettle)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          display: "block",
                          marginTop: 8,
                        }}
                      >
                        {truncateAddress(task.txSettle, 8, 8)}
                      </a>
                    )}
                    <div
                      className="data"
                      style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}
                    >
                      {task.decidedAt ? formatDateTime(task.decidedAt) : ""}
                    </div>
                  </div>
                  <div
                    className="data"
                    style={{ fontSize: 22, fontWeight: 600, whiteSpace: "nowrap" }}
                  >
                    {formatUsdc(task.bountyAmount)} USDC
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <MetaRow
        footnote="Verdict final unless appealed within 24 hours."
        record={`RECORD ${recordNumber} · VERDICT`}
      />
    </article>
  );
}

function Empty({ heading, body }: { heading: string; body: string }) {
  return (
    <article>
      <h1 className="page-title">{heading}</h1>
      <p style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 12 }}>
        {body}{" "}
        <Link href="/docket" style={{ color: "var(--accent)" }}>
          Back to the docket
        </Link>
        .
      </p>
      <MetaRow footnote="Nothing here." record="RECORD — NOT FOUND" />
    </article>
  );
}
