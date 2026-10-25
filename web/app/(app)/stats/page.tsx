/**
 * /stats - what the chain says Rubric has done.
 *
 * Every figure here is computed from the program's Task accounts, not from our database, so
 * a visitor can recompute all of it. Two things are deliberately loud:
 *
 *  - On anything but mainnet the page opens with TEST NETWORK - NOT TRACTION, before a single
 *    figure. Test funds are not demand, and the page must not be quotable as if they were.
 *  - Tasks where one wallet posted and worked are set aside, shown beside the headline and
 *    never inside it.
 *
 * The page adds no claim of its own. The words and the numbers come from lib/traction-view.ts,
 * where they are tested; this file only lays them out. Sentences are set in the prose face and
 * every figure inside them in the figure face (DESIGN.md), via splitFigures.
 */

import { MetaRow } from "@/components/MetaRow";
import { getTraction } from "@/lib/server/traction";
import { TeamWalletsError } from "@/lib/team-wallets";
import {
  buildTractionView,
  splitFigures,
  type TractionView,
  type ViewRow,
  type WeekRow,
} from "@/lib/traction-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rubric — Stats" };

/** A sentence, with its numbers and addresses in the figure face. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {splitFigures(text).map((segment, i) =>
        segment.figure ? (
          <span key={i} className="data">
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}

function SectionHead({
  id,
  title,
  kicker,
  warn = false,
}: {
  id: string;
  title: string;
  kicker?: string;
  /** Unresolved, not failed: the held-state colour, used when something the reader needs is missing. */
  warn?: boolean;
}) {
  return (
    <header style={{ marginBottom: 12 }}>
      <h2 id={id} className="label label-11" style={{ color: "var(--text)" }}>
        {title}
      </h2>
      {kicker && (
        <p className="label" style={{ margin: "6px 0 0", color: warn ? "var(--warning)" : undefined }}>
          {kicker}
        </p>
      )}
    </header>
  );
}

/** A record table: one measurement per row, the label as the row header. */
function LedgerTable({ labelledBy, rows }: { labelledBy: string; rows: ViewRow[] }) {
  return (
    <table aria-labelledby={labelledBy} style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} style={{ borderTop: "1px solid var(--hairline)" }}>
            <th
              scope="row"
              className="label"
              style={{ textAlign: "left", verticalAlign: "top", padding: "14px 16px 14px 0", width: "34%" }}
            >
              {row.label}
            </th>
            <td style={{ padding: "11px 0" }}>
              <div className="data" style={{ fontSize: 15 }}>
                {row.value}
              </div>
              {row.note && (
                <div
                  className="data"
                  style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginTop: 4 }}
                >
                  {row.note}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeeklyTable({ labelledBy, weeks }: { labelledBy: string; weeks: WeekRow[] }) {
  const head = { padding: "0 0 10px", fontWeight: 500 } as const;
  return (
    <table aria-labelledby={labelledBy} style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border-strong)" }}>
          <th scope="col" className="label" style={{ ...head, textAlign: "left" }}>
            WEEK STARTING
          </th>
          <th scope="col" className="label" style={{ ...head, textAlign: "right" }}>
            SETTLED
          </th>
          <th scope="col" className="label" style={{ ...head, textAlign: "right" }}>
            VOLUME
          </th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w.week} style={{ borderBottom: "1px solid var(--hairline)" }}>
            <th scope="row" className="data" style={{ textAlign: "left", fontSize: 13, padding: "11px 0" }}>
              {w.week}
            </th>
            <td className="data" style={{ textAlign: "right", fontSize: 13 }}>
              {w.settled}
            </td>
            <td className="data" style={{ textAlign: "right", fontSize: 13 }}>
              {w.volume}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The one thing shown before any figure when the numbers come from a test network. */
function TestNetworkNotice({ notice }: { notice: NonNullable<TractionView["notice"]> }) {
  return (
    <section
      aria-labelledby="test-network"
      style={{
        border: "1px solid var(--border-strong)",
        background: "var(--surface)",
        padding: "20px 24px",
        marginTop: 24,
      }}
    >
      <h2 id="test-network" className="label label-11" style={{ color: "var(--warning)" }}>
        {notice.heading}
      </h2>
      <p style={{ fontSize: 15, margin: "8px 0 0", maxWidth: "62ch" }}>{notice.explanation}</p>
    </section>
  );
}

/**
 * Two different failures, told apart because the fix is different. A chain that cannot be read
 * will come back; a team wallet list that is invalid will not until someone fixes the
 * configuration, and saying "the chain could not be read" would send them to the wrong place.
 * Neither message carries a value from the configuration or from the RPC.
 */
function Unavailable({ reason }: { reason: "chain" | "team-wallets" }) {
  const misconfigured = reason === "team-wallets";
  return (
    <section aria-labelledby="unavailable" style={{ marginTop: 32 }}>
      <h2 id="unavailable" className="label label-11" style={{ color: misconfigured ? "var(--warning)" : "var(--text)" }}>
        {misconfigured ? "THE LIST OF TEAM WALLETS IS INVALID" : "THE CHAIN COULD NOT BE READ JUST NOW"}
      </h2>
      <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "10px 0 0", maxWidth: "62ch" }}>
        {misconfigured
          ? "No figures are shown, because figures computed without a correct list could include the team's own activity. This is a configuration fix for whoever runs this site. Nothing about escrow depends on this page."
          : "No figures are shown, rather than guessed ones. Nothing about escrow depends on this page. Reload in a minute."}
      </p>
    </section>
  );
}

export default async function StatsPage() {
  let view: TractionView | null = null;
  let failure: "chain" | "team-wallets" = "chain";
  try {
    const { value, ageMs, stale } = await getTraction();
    view = buildTractionView(value.report, value.provenance, {
      stale,
      ageSeconds: Math.round(ageMs / 1000),
    });
  } catch (error) {
    // Already logged, by name only, where the read failed. The page says only which kind it was.
    view = null;
    failure = error instanceof TeamWalletsError ? "team-wallets" : "chain";
  }

  return (
    <article>
      <h1 className="page-title">Stats</h1>
      <p className="page-lede">
        Read from the chain, not from our database. Anyone can recompute every figure on this page.
      </p>

      {view === null ? (
        <Unavailable reason={failure} />
      ) : (
        <>
          {/* Before any figure, and whenever the cluster is not mainnet. */}
          {view.notice && <TestNetworkNotice notice={view.notice} />}

          {view.stale && (
            <p role="status" className="label" style={{ color: "var(--warning)", marginTop: 16 }}>
              THE CHAIN COULD NOT BE REACHED JUST NOW. THIS IS A COPY READ {view.stale.ageSeconds}s AGO.
            </p>
          )}

          <hr className="rule" style={{ marginTop: 24 }} />

          <div
            className="app-two-col"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 280px",
              gap: 32,
              marginTop: 24,
              alignItems: "start",
            }}
          >
            {/* minmax(0, 1fr), not the implicit auto track: an auto track grows to the widest table and
                pushes the whole column off a phone screen. */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 48, minWidth: 0 }}>
              <section aria-labelledby="headline">
                <SectionHead
                  id="headline"
                  title="HEADLINE"
                  kicker={view.headlineKicker}
                  warn={view.teamWallets.length === 0}
                />
                <LedgerTable labelledBy="headline" rows={view.headline} />
              </section>

              <section aria-labelledby="set-aside">
                <SectionHead
                  id="set-aside"
                  title="SET ASIDE, SHOWN SO NOTHING IS HIDDEN"
                  kicker="Poster and worker are the same wallet"
                />
                <LedgerTable labelledBy="set-aside" rows={view.setAside} />
              </section>

              <section aria-labelledby="team">
                <SectionHead
                  id="team"
                  title="SET ASIDE: TEAM-CONTROLLED WALLETS"
                  kicker={
                    view.teamWallets.length > 0
                      ? "A declared team wallet posted or worked the task"
                      : "None declared"
                  }
                  warn={view.teamWallets.length === 0}
                />
                {view.teamWallets.length > 0 ? (
                  <>
                    <LedgerTable labelledBy="team" rows={view.teamControlled} />
                    <p className="label" style={{ margin: "20px 0 8px" }}>
                      DECLARED WALLETS
                    </p>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                      {view.teamWallets.map((wallet) => (
                        <li key={wallet} className="data data--long">
                          {wallet}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p style={{ fontSize: 15, margin: 0, maxWidth: "62ch" }}>
                    No team wallets were declared, so nothing is set aside here, and anything the team funded or
                    worked is counted in the headline above.
                  </p>
                )}
              </section>

              <section aria-labelledby="weekly">
                <SectionHead
                  id="weekly"
                  title="SETTLED PER WEEK"
                  kicker="Headline only. Weeks start on Monday, UTC"
                />
                {view.weekly.length > 0 ? (
                  <WeeklyTable labelledBy="weekly" weeks={view.weekly} />
                ) : (
                  <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
                    Nothing has settled yet.
                  </p>
                )}
              </section>

              <section aria-labelledby="caveats">
                <SectionHead id="caveats" title="READ THIS BEFORE QUOTING ANY OF IT" />
                <ul style={{ margin: 0, padding: "0 0 0 18px", display: "grid", gap: 10, maxWidth: "70ch" }}>
                  {view.caveats.map((caveat) => (
                    <li key={caveat} style={{ fontSize: 15, lineHeight: 1.5 }}>
                      <Prose text={caveat} />
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="verify">
                <SectionHead id="verify" title="CHECK IT YOURSELF" />
                <ul style={{ margin: 0, padding: "0 0 0 18px", display: "grid", gap: 10, maxWidth: "70ch" }}>
                  {view.verify.map((line) => (
                    <li key={line} style={{ fontSize: 15, lineHeight: 1.5 }}>
                      {line}
                    </li>
                  ))}
                </ul>
                <pre
                  className="data"
                  tabIndex={0}
                  style={{
                    margin: "16px 0 0",
                    padding: "12px 16px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    fontSize: 12,
                    fontWeight: 400,
                    overflowX: "auto",
                  }}
                >
                  {view.command}
                </pre>
              </section>
            </div>

            {/* ---------------- RIGHT RAIL: where the numbers came from ---------------- */}
            <aside
              aria-labelledby="provenance"
              style={{ borderLeft: "1px solid var(--border)", paddingLeft: 32, minWidth: 0 }}
            >
              <SectionHead id="provenance" title="WHERE THESE CAME FROM" />
              <dl style={{ margin: 0 }}>
                {view.provenance.map((row, i) => (
                  <div
                    key={row.label}
                    style={{
                      padding: "14px 0",
                      borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                      minWidth: 0,
                    }}
                  >
                    <dt className="label">{row.label}</dt>
                    <dd style={{ margin: "6px 0 0" }}>
                      <div className={row.label === "Program" ? "data data--long" : "data"} style={{ fontSize: row.label === "Program" ? undefined : 14 }}>
                        {row.value}
                      </div>
                      {row.note && (
                        <div
                          className="data"
                          style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginTop: 4 }}
                        >
                          {row.note}
                        </div>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p style={{ fontSize: 14, margin: "8px 0 0", display: "grid", gap: 6 }}>
                {view.explorerUrl && (
                  <a
                    href={view.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="stat-link"
                    style={{ color: "var(--accent)" }}
                  >
                    Open the program on Explorer
                  </a>
                )}
                <a href="/api/stats" className="stat-link" style={{ color: "var(--accent)" }}>
                  The same figures as JSON
                </a>
              </p>
            </aside>
          </div>
        </>
      )}

      <MetaRow footnote="Amounts in USDC. Computed from the chain." record="RECORD INDEX · STATS" />
    </article>
  );
}
