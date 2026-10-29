import { useState } from "react";
import { Plus, Check, ArrowRight, Trash2 } from "lucide-react";
import type { Lesson } from "../types";
import "./Roadmap.css";
export default function Roadmap({
  lesson,
  onChange,
  onContinue,
}: {
  lesson: Lesson;
  onChange: (patch: Partial<Lesson>) => void;
  onContinue: (text: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <details className="roadmap">
      <summary>
        Learning roadmap{" "}
        <span>{lesson.goals?.length || 0} stepping stones</span>
      </summary>
      <div className="roadmap-content">
        <label>
          Current place
          <input
            aria-label="Lesson position"
            value={lesson.position}
            maxLength={500}
            onChange={(e) => onChange({ position: e.target.value })}
          />
        </label>
        <p>
          Move at your own pace. Visiting a topic does not mark it as
          understood.
        </p>
        {lesson.goals?.map((goal) => (
          <div className="roadmap-goal" key={goal.id}>
            <button
              className="icon-button"
              aria-label={
                "Mark " +
                goal.title +
                (goal.status === "visited" ? " planned" : " visited")
              }
              onClick={() =>
                onChange({
                  goals: lesson.goals!.map((g) =>
                    g.id === goal.id
                      ? {
                          ...g,
                          status:
                            g.status === "visited" ? "planned" : "visited",
                        }
                      : g,
                  ),
                })
              }
            >
              {goal.status === "visited" ? (
                <Check size={15} />
              ) : (
                <span className={"goal-dot " + goal.status} />
              )}
            </button>
            <div>
              <strong>{goal.title}</strong>
              {goal.prerequisites.length > 0 && (
                <small>Builds on: {goal.prerequisites.join(", ")}</small>
              )}
            </div>
            <button
              className="icon-button"
              aria-label={"Learn " + goal.title}
              onClick={() => {
                onChange({
                  position: goal.title,
                  goals: lesson.goals!.map((g) => ({
                    ...g,
                    status:
                      g.id === goal.id
                        ? "current"
                        : g.status === "current"
                          ? "planned"
                          : g.status,
                  })),
                });
                onContinue(
                  "Continue the learning objective with: " + goal.title,
                );
              }}
            >
              <ArrowRight size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={"Remove " + goal.title}
              onClick={() =>
                onChange({
                  goals: lesson.goals!.filter((g) => g.id !== goal.id),
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <form
          className="roadmap-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              onChange({
                goals: [
                  ...(lesson.goals || []),
                  {
                    id: crypto.randomUUID(),
                    title: title.trim(),
                    status: "planned",
                    prerequisites: [],
                  },
                ],
              });
              setTitle("");
            }
          }}
        >
          <input
            aria-label="New roadmap goal"
            value={title}
            placeholder="Add a stepping stone…"
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            disabled={!title.trim() || (lesson.goals?.length || 0) >= 20}
            aria-label="Add roadmap goal"
          >
            <Plus size={15} />
          </button>
        </form>
      </div>
    </details>
  );
}
