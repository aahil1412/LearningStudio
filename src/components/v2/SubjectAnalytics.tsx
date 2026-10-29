import type { ReviewAttempt } from "../../types";
import type { SubjectSnapshot } from "../../v2types";
export function reviewWeeks(attempts: ReviewAttempt[], at = Date.now()) {
  const day = 86400000,
    start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 49);
  return Array.from({ length: 8 }, (_, index) => {
    const from = start.getTime() + index * 7 * day,
      until = from + 7 * day,
      rows = attempts.filter(
        (attempt) =>
          Date.parse(attempt.createdAt) >= from &&
          Date.parse(attempt.createdAt) < until &&
          Date.parse(attempt.createdAt) <= at,
      );
    return {
      date: new Date(from).toISOString().slice(0, 10),
      correct: rows.filter((row) => row.correct === true).length,
      incorrect: rows.filter((row) => row.correct === false).length,
      uncertain: rows.filter((row) => row.correct === null).length,
      total: rows.length,
    };
  });
}
export default function SubjectAnalytics({
  snapshot,
  attempts,
  onOpenChat,
}: {
  snapshot: SubjectSnapshot;
  attempts: ReviewAttempt[];
  onOpenChat: (id: string) => void;
}) {
  const weeks = reviewWeeks(attempts),
    maximum = Math.max(1, ...weeks.map((week) => week.total)),
    attention = snapshot.concepts.filter((concept) =>
      ["review", "misconception", "unresolved"].includes(concept.status),
    );
  return (
    <section className="v2-card subject-analytics">
      <h2>Learning history & evidence</h2>
      <p>
        Review outcomes over the last eight weeks. Correct answers are evidence
        for the specific task; they do not automatically establish conceptual
        understanding.
      </p>
      {attempts.length ? (
        <>
          <svg
            viewBox="0 0 640 165"
            role="img"
            aria-label="Weekly review outcomes: checked correct, incorrect, and uncertain or skipped"
          >
            <title>Review outcomes by week, starting Monday in UTC</title>
            {weeks.map((week, index) => {
              const x = 45 + index * 72,
                scale = 105 / maximum;
              return (
                <g key={week.date}>
                  <rect
                    x={x}
                    y={125 - week.correct * scale}
                    width="36"
                    height={week.correct * scale}
                    fill="var(--success)"
                  />
                  <rect
                    x={x}
                    y={125 - (week.correct + week.incorrect) * scale}
                    width="36"
                    height={week.incorrect * scale}
                    fill="var(--warning)"
                  />
                  <rect
                    x={x}
                    y={125 - week.total * scale}
                    width="36"
                    height={week.uncertain * scale}
                    fill="var(--secondary)"
                  />
                  <text
                    x={x + 18}
                    y={Math.max(12, 119 - week.total * scale)}
                    textAnchor="middle"
                    fill="var(--text)"
                    fontSize="11"
                  >
                    {week.total}
                  </text>
                  <text
                    x={x + 18}
                    y="146"
                    textAnchor="middle"
                    fill="var(--secondary)"
                    fontSize="10"
                  >
                    {week.date.slice(5)}
                  </text>
                </g>
              );
            })}
            <line x1="30" y1="126" x2="630" y2="126" stroke="var(--border)" />
          </svg>
          <div className="analytics-legend">
            <span>
              <i style={{ background: "var(--success)" }} />
              Checked correct
            </span>
            <span>
              <i style={{ background: "var(--warning)" }} />
              Incorrect
            </span>
            <span>
              <i style={{ background: "var(--secondary)" }} />
              Uncertain / skipped
            </span>
          </div>
          <details>
            <summary>Review data table · weeks in UTC</summary>
            <table>
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Correct</th>
                  <th>Incorrect</th>
                  <th>Uncertain / skipped</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.date}>
                    <td>{week.date}</td>
                    <td>{week.correct}</td>
                    <td>{week.incorrect}</td>
                    <td>{week.uncertain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="muted">
          Review history appears when you choose to practice. Assessment remains
          optional.
        </p>
      )}
      <h3>Concepts needing attention</h3>
      {attention.length ? (
        attention.slice(0, 12).map((concept) => (
          <div className="analytics-attention" key={concept.id}>
            <span>
              <strong>{concept.label}</strong>
              <small>
                {concept.status} ·{" "}
                {concept.evidence || "No supporting explanation recorded."}
              </small>
            </span>
            {concept.lessonId && (
              <button onClick={() => onOpenChat(concept.lessonId!)}>
                Open evidence
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="muted">
          No concepts are currently marked for review or as unresolved gaps.
        </p>
      )}
      <h3>Recent evidence</h3>
      {snapshot.evidence.slice(0, 5).map((evidence) => (
        <div className="analytics-attention" key={evidence.id}>
          <span>
            <strong>
              {snapshot.concepts.find(
                (concept) => concept.id === evidence.conceptId,
              )?.label || "Concept evidence"}
            </strong>
            <small>
              {evidence.kind} ·{" "}
              {new Date(evidence.createdAt).toLocaleDateString()} ·{" "}
              {evidence.content}
            </small>
          </span>
          {evidence.conversationId && (
            <button onClick={() => onOpenChat(evidence.conversationId!)}>
              Source
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
