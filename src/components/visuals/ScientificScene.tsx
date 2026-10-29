import { useId, useState } from "react";
import SciencePopover from "./SciencePopover";
import type { IllustrationSpec } from "../../types";
import { useVisualState } from "../../lib/visualState";
import "./scientific-scene.css";

type Participant = NonNullable<
  IllustrationSpec["scene"]
>["participants"][number];
const descriptions: Record<Participant["shape"], string> = {
  cell: "A living cell shown as a bounded compartment. Internal structures are omitted.",
  complex:
    "A functional assembly. This shape does not represent atomic coordinates.",
  rna: "A schematic single RNA strand; no sequence is assumed.",
  dna: "A schematic DNA double strand; no sequence is assumed.",
  protein: "A compact folded-chain symbol, not an atomic structure.",
  "unfolded-protein":
    "An extended-chain symbol with exposed regions; no atomic connectivity is specified.",
  aggregate:
    "Several separate chains associated together, rather than one larger folded molecule.",
  field:
    "A schematic field profile across space, not a material membrane or surface.",
  photon:
    "A wavy line is a diagram convention for a photon field, not its literal path or shape.",
  fermion:
    "An oriented line is a Feynman-diagram convention for a fermion, not a tiny physical arrow.",
  gluon:
    "A curly line is a Feynman-diagram convention for a gluon, not its literal shape.",
  particle: "A conceptual particle or material input, not an atomic structure.",
  compartment: "A region used to separate the processes being explained.",
  source: "An input or energy source for the illustrated process.",
  barrier: "A boundary that separates regions or controls exchange.",
};
function Glyph({ shape }: { shape: Participant["shape"] }) {
  if (shape === "dna")
    return (
      <g className="scene-dna">
        {[-1, 1].map((side) => (
          <path
            key={side}
            d={`M${side * -32} -60 C${side * 70} -30 ${side * -70} 30 ${side * 32} 60`}
          />
        ))}
        {[-45, -20, 5, 30, 50].map((y, i) => (
          <path key={y} d={`M${i % 2 ? -25 : 25} ${y} H${i % 2 ? 25 : -25}`} />
        ))}
      </g>
    );
  if (shape === "rna")
    return (
      <g className="scene-rna">
        <path d="M-60 25 C-50-65 10 65 18-20 S70-65 60 35" />
        {[-48, -22, 6, 34, 58].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? -7 : 22} r="7" />
        ))}
      </g>
    );
  if (shape === "protein")
    return (
      <g className="scene-protein">
        <path d="M-50 4C-38-44-3-50 28-28S51 22 23 40S-35 26-28-8S20-18 17 7S-7 31-15 13S-1-10 11-1" />
        <circle cx="-50" cy="4" r="4" />
        <circle cx="11" cy="-1" r="4" />
      </g>
    );
  if (shape === "unfolded-protein")
    return (
      <g className="scene-protein">
        <path d="M-65 10C-48-60-25 52-9-8S26 56 38-4S56-30 65 0" />
        <circle cx="-24" cy="10" r="7" />
        <circle cx="38" cy="-4" r="7" />
      </g>
    );
  if (shape === "aggregate")
    return (
      <g className="scene-complex">
        {[-28, 0, 28].map((x, i) => (
          <path
            key={x}
            transform={`translate(${x} ${i % 2 ? 20 : -10}) rotate(${i * 27})`}
            d="M-20 15C-35-15-6-40 12-20S30 13 10 25S-18 0-8-10"
          />
        ))}
      </g>
    );
  if (shape === "field" || shape === "photon")
    return (
      <g className="scene-field">
        <path d="M-65 0H65" />
        <path d="M-65 0q13-65 26 0t26 0t26 0t26 0t26 0" />
      </g>
    );
  if (shape === "fermion")
    return (
      <g className="scene-fermion">
        <path d="M-65 0H65M-6-13L16 0L-6 13" />
      </g>
    );
  if (shape === "gluon")
    return (
      <g className="scene-gluon">
        <path
          d={Array.from({ length: 121 }, (_, i) => {
            const t = i / 120;
            return `${i ? "L" : "M"}${-60 + 120 * t + 8 * Math.sin(t * Math.PI * 14)} ${18 * Math.cos(t * Math.PI * 14)}`;
          }).join(" ")}
        />
      </g>
    );
  if (shape === "cell")
    return (
      <g className="scene-cell">
        <ellipse rx="72" ry="61" />
        <ellipse rx="62" ry="51" />
        <path d="M-35-10q24-24 54-7M-25 26q35 13 55-8" />
      </g>
    );
  if (shape === "complex")
    return (
      <g className="scene-complex">
        <path d="M-65 10Q-76-50-20-52Q2-84 38-48Q88-37 63 13Q84 64 15 58Q-53 80-65 10Z" />
        <path d="M-47 20Q4-22 46 18" />
      </g>
    );
  if (shape === "source")
    return (
      <g className="scene-source">
        <circle r="34" />
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} transform={`rotate(${i * 45})`} d="M0-45V-66" />
        ))}
      </g>
    );
  if (shape === "barrier")
    return (
      <g className="scene-barrier">
        <path d="M-20-60V-18M-20 18V60M20-60V-18M20 18V60" />
        <path d="M-32-18H32M-32 18H32" />
      </g>
    );
  if (shape === "compartment")
    return (
      <g className="scene-compartment">
        <rect x="-68" y="-57" width="136" height="114" rx="24" />
        <path d="M-38-28h76M-38 0h48M-38 28h66" />
      </g>
    );
  return (
    <g className="scene-particle">
      <circle r="24" />
      <path d="M-36 0H-26M26 0H36M0-36V-26M0 26V36" />
    </g>
  );
}
function wrap(label: string) {
  const width = (word: string) =>
    [...word].reduce(
      (sum, char) =>
        sum +
        (/[MW@#%&]/.test(char)
          ? 23
          : (char.codePointAt(0) ?? 0) >= 0x3000
            ? 24
            : /[il.,' ]/.test(char)
              ? 8
              : 15),
      0,
    );
  const pieces = label
    .replace(/([–—-])/g, "$1 ")
    .split(/\s+/)
    .flatMap((word) => {
      if (width(word) <= 180) return [word];
      const parts: string[] = [];
      let part = "";
      for (const char of word) {
        if (width(part + char) > 180) {
          parts.push(part);
          part = "";
        }
        part += char;
      }
      if (part) parts.push(part);
      return parts;
    });
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces) {
    if (line && width(line + " " + piece) > 180) {
      lines.push(line);
      line = piece;
    } else line += (line ? " " : "") + piece;
  }
  if (line) lines.push(line);
  return lines;
}
function referenceX(from: number, to: number, columns: number[]) {
  const low = Math.min(from, to) + 16,
    high = Math.max(from, to) - 16;
  const blockers = columns
    .filter((x) => x > low && x < high)
    .sort((a, b) => a - b);
  let best = { x: (low + high) / 2, width: 0 },
    start = low;
  for (const end of [...blockers, high + 20]) {
    const width = Math.min(high, end - 20) - start;
    if (width > best.width) best = { x: start + width / 2, width };
    start = end + 20;
  }
  return best.x;
}
export default function ScientificScene({ spec }: { spec: IllustrationSpec }) {
  const scene = spec.scene!,
    marker = useId().replace(/:/g, "");
  const [anchor, setAnchor] = useState<Element | null>(null);
  const [step, setStep] = useVisualState("scene.step", 0);
  const [selected, setSelected] = useVisualState("scene.selection", "");
  const [relation, setRelation] = useVisualState<number | null>(
    "scene.relation",
    null,
  );
  const steps = scene.steps || [];
  const currentStep = Number.isInteger(step)
    ? Math.max(0, Math.min(step, Math.max(0, steps.length - 1)))
    : 0;
  const current = steps[currentStep],
    active = new Set(current?.activeIds || []);
  const nodeIndex = new Map(scene.participants.map((p, i) => [p.id, i]));
  const pairCounts = new Map<string, number>();
  for (const edge of scene.relations) {
    const key = [edge.from, edge.to].sort().join("|");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const isDirect = (
    edge: NonNullable<IllustrationSpec["scene"]>["relations"][number],
  ) =>
    Math.abs(nodeIndex.get(edge.from)! - nodeIndex.get(edge.to)!) === 1 &&
    pairCounts.get([edge.from, edge.to].sort().join("|")) === 1;
  const topEdges = scene.relations
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => !isDirect(edge));
  const centerY = (topEdges.length ? 62 + topEdges.length * 40 : 64) + 96;
  const positions = new Map(
    scene.participants.map((p, i) => [
      p.id,
      {
        x: 120 + (i * 660) / Math.max(1, scene.participants.length - 1),
        y: centerY,
      },
    ]),
  );
  const ports = new Map<string, number[]>();
  for (const { edge, index } of topEdges)
    for (const id of [edge.from, edge.to])
      ports.set(id, [...(ports.get(id) ?? []), index]);
  const portX = (id: string, index: number) => {
    const siblings = ports.get(id) ?? [];
    return (
      positions.get(id)!.x +
      (siblings.indexOf(index) - (siblings.length - 1) / 2) * 20
    );
  };
  const columns = topEdges.flatMap(({ edge, index }) => [
    portX(edge.from, index),
    portX(edge.to, index),
  ]);
  const labelY = centerY + 108,
    height =
      labelY +
      Math.max(...scene.participants.map((p) => wrap(p.label).length)) * 28 +
      34;
  const inspected = scene.participants.find((p) => p.id === selected);
  const inspectedEdge =
    relation !== null && Number.isInteger(relation)
      ? scene.relations[relation]
      : undefined;
  const selectParticipant = (id: string, element?: Element) => {
    setAnchor(element || null);
    setSelected(id);
    setRelation(null);
  };
  const selectEdge = (index: number, element?: Element) => {
    setAnchor(element || null);
    setRelation(index);
    setSelected("");
  };
  return (
    <div className="scientific-scene">
      <section
        className="scene-inspector"
        aria-label="Scientific figure explanation"
        aria-live="polite"
      >
        {inspectedEdge && !anchor ? (
          <>
            <strong>
              Relationship {relation! + 1}: {inspectedEdge.kind}
            </strong>
            <p>
              {
                scene.participants.find((p) => p.id === inspectedEdge.from)
                  ?.label
              }{" "}
              {inspectedEdge.kind === "binding" ? "↔" : "→"}{" "}
              {scene.participants.find((p) => p.id === inspectedEdge.to)?.label}
            </p>
            <p>{inspectedEdge.label}</p>
          </>
        ) : inspected && !anchor ? (
          <>
            <strong>{inspected.label}</strong>
            <p>{inspected.description || descriptions[inspected.shape]}</p>
          </>
        ) : (
          <p>
            Select a scientific participant or a numbered arrow to inspect its
            role. Highlighted participants show the current explanatory step.
          </p>
        )}
      </section>
      <div
        className="science-viewport"
        tabIndex={0}
        role="region"
        aria-label="Interactive scientific figure; scroll horizontally in a narrow reading pane"
      >
        <svg
          className="scientific-svg scene-svg"
          viewBox={`0 0 900 ${height}`}
          role="group"
          aria-label={spec.title}
        >
          <title>{spec.title}</title>
          <desc>
            Functional symbols with separate labels. Select a participant or a
            numbered relationship to inspect its meaning. These are not atomic
            coordinates.
          </desc>
          <defs>
            <marker
              id={marker}
              markerUnits="userSpaceOnUse"
              markerWidth="12"
              markerHeight="12"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              orient="auto-start-reverse"
            >
              <path d="M1 1L11 6L1 11Z" fill="context-stroke" />
            </marker>
          </defs>
          <g className="scene-connections">
            {scene.relations.map((edge, index) => {
              const a = positions.get(edge.from)!,
                b = positions.get(edge.to)!,
                direction = b.x > a.x ? 1 : -1,
                direct = isDirect(edge);
              const lane =
                  48 + topEdges.findIndex((item) => item.index === index) * 40,
                from = portX(edge.from, index),
                to = portX(edge.to, index);
              const d = direct
                ? `M${a.x + 82 * direction} ${centerY}H${b.x - 90 * direction}`
                : `M${from} ${centerY - 82}V${lane}H${to}V${centerY - 82}`;
              const x = direct
                ? (a.x + b.x) / 2
                : referenceX(from, to, columns);
              return (
                <g
                  key={index}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect relationship ${index + 1}: ${edge.label}`}
                  aria-pressed={relation === index}
                  className={`scene-relation scene-${edge.kind} ${active.has(edge.from) && active.has(edge.to) ? "is-active" : ""} ${relation === index ? "is-selected" : ""}`}
                  onClick={(event) => selectEdge(index, event.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectEdge(index, e.currentTarget);
                    }
                  }}
                >
                  <path
                    d={d}
                    markerEnd={`url(#${marker})`}
                    markerStart={
                      edge.kind === "binding" ? `url(#${marker})` : undefined
                    }
                  />
                  <text
                    x={x}
                    y={direct ? centerY - 13 : lane - 12}
                    textAnchor="middle"
                    className="scene-edge-reference"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </text>
                </g>
              );
            })}
          </g>
          {scene.participants.map((p) => {
            const point = positions.get(p.id)!;
            return (
              <g
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${p.label}`}
                aria-pressed={selected === p.id}
                data-participant-id={p.id}
                className={`scene-participant ${selected === p.id ? "is-selected" : ""} ${active.has(p.id) ? "is-active" : ""}`}
                onClick={(event) =>
                  selectParticipant(p.id, event.currentTarget)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectParticipant(p.id, e.currentTarget);
                  }
                }}
              >
                <g
                  transform={`translate(${point.x} ${point.y})`}
                  className="scene-symbol"
                >
                  <ellipse rx="85" ry="79" className="scene-focus-ring" />
                  <Glyph shape={p.shape} />
                </g>
                <text
                  x={point.x}
                  y={labelY}
                  textAnchor="middle"
                  className="scene-label"
                >
                  {wrap(p.label).map((line, i) => (
                    <tspan key={i} x={point.x} dy={i ? 28 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {steps.length > 1 && (
        <div className="scene-playback" aria-label="Scientific scene steps">
          <button
            onClick={() => {
              setStep(Math.max(0, currentStep - 1));
            }}
            disabled={currentStep === 0}
          >
            Previous step
          </button>
          <output>
            Step {currentStep + 1} of {steps.length}
          </output>
          <button
            onClick={() => {
              setStep(Math.min(steps.length - 1, currentStep + 1));
            }}
            disabled={currentStep >= steps.length - 1}
          >
            Next step
          </button>
          <button
            onClick={() => {
              setStep(0);
              setSelected("");
              setRelation(null);
            }}
          >
            Reset
          </button>
        </div>
      )}
      {current && (
        <p className="scene-step" aria-live="polite">
          <strong>{current.label}.</strong> {current.description}
        </p>
      )}
      {scene.relations.length > 0 && (
        <details className="scene-relationship-details">
          <summary>All {scene.relations.length} connections</summary>
          <ol
            className="scene-relationship-key"
            aria-label="Scientific relationships"
          >
            {scene.relations.map((edge, index) => (
              <li
                key={index}
                className={relation === index ? "is-selected" : ""}
              >
                <button
                  aria-label={`Show relationship ${index + 1}`}
                  onClick={(event) => selectEdge(index, event.currentTarget)}
                >
                  {scene.participants.find((p) => p.id === edge.from)?.label}{" "}
                  {edge.kind === "binding" ? "↔" : "→"}{" "}
                  {scene.participants.find((p) => p.id === edge.to)?.label}
                </button>
                : {edge.label}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="scene-assumption">
        Relationship diagram. Select a component to read its meaning. Arrows
        encode the stated relationships, not measured motion or reaction rates.
      </p>
      <SciencePopover
        anchor={anchor}
        title={
          inspectedEdge
            ? `Connection ${relation! + 1}`
            : inspected?.label || "Figure explanation"
        }
        onClose={() => setAnchor(null)}
      >
        {inspectedEdge ? (
          <p>{inspectedEdge.label}</p>
        ) : inspected ? (
          <p>{inspected.description || descriptions[inspected.shape]}</p>
        ) : null}
      </SciencePopover>
    </div>
  );
}
