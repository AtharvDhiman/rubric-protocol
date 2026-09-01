/**
 * The sealed clauses.
 *
 * These are the tolerances the submission is measured against: hashed into a
 * PDA before any work started, and the only things the judge is permitted to
 * rule on. The numbering is mono and zero-padded because a clause index is a
 * figure someone will cite ("blocked at clause 02"), not decoration.
 *
 * Each row carries `data-clause-index` and a datum dot. The inspection arm in
 * the gutter measures those rows and parks its probe on the dot of the clause
 * it is ruling on, so the drawing is aligned to the real DOM rather than to a
 * guessed row height - which matters because clause text is user-authored and
 * every row is a different height.
 */

export function ClauseList({
  clauses,
  listId,
}: {
  clauses: string[];
  /** Lets the arm find this list. Omit it on screens with no rig. */
  listId?: string;
}) {
  return (
    <ol id={listId} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {clauses.map((clause, i) => (
        <li
          key={i}
          data-clause-index={i}
          style={{
            position: "relative",
            display: "flex",
            gap: 16,
            padding: "16px 0",
            borderBottom:
              i === clauses.length - 1 ? "none" : "1px solid var(--hairline)",
          }}
        >
          {/* The datum. The probe touches this exact point, so it is positioned
              from the row rather than drawn inside the arm's own coordinates. */}
          <span
            data-clause-datum
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -10,
              top: "50%",
              width: 3,
              height: 3,
              marginTop: -1.5,
              background: "var(--text)",
            }}
          />
          <span
            className="data"
            style={{
              fontSize: 13,
              paddingTop: 3,
              color: "var(--accent)",
              minWidth: 20,
            }}
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 15, lineHeight: 1.62, color: "var(--text-2)" }}>
            {clause}
          </span>
        </li>
      ))}
    </ol>
  );
}
