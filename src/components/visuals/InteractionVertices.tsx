import { useId, useState } from "react";
import type { IllustrationSpec } from "../../types";
import { useVisualState } from "../../lib/visualState";
import SciencePopover from "./SciencePopover";
import "./scientific-models.css";
type Vertex = "matter" | "three-boson" | "four-boson";
function bosonPath(x: number, y: number, curly: boolean) {
  const dx = x - 450,
    dy = y - 215,
    length = Math.hypot(dx, dy),
    nx = -dy / length,
    ny = dx / length;
  return Array.from({ length: 201 }, (_, i) => {
    const t = i / 200,
      angle = t * Math.PI * 14,
      offset =
        (curly ? Math.cos(angle) : Math.sin(angle)) *
        15 *
        Math.sin((Math.min(1, t * 8, (1 - t) * 8) * Math.PI) / 2);
    const along = curly ? Math.sin(angle) * 6 : 0;
    return `${i ? "L" : "M"}${(450 + t * dx + nx * offset + (dx / length) * along).toFixed(2)} ${(215 + t * dy + ny * offset + (dy / length) * along).toFixed(2)}`;
  }).join(" ");
}
export default function InteractionVertices({
  spec,
}: {
  spec: IllustrationSpec;
}) {
  const marker = useId().replace(/:/g, "");
  const [savedTheory, setTheory] = useVisualState<"qed" | "qcd">(
      "interaction.theory",
      spec.interaction?.theory ?? "qcd",
    ),
    [savedVertex, setVertex] = useVisualState<Vertex>(
      "interaction.vertex",
      spec.interaction?.vertex ?? "matter",
    ),
    [selected, setSelected] = useVisualState("interaction.selection", "");
  const theory = savedTheory === "qed" ? "qed" : "qcd",
    vertex: Vertex =
      theory === "qed"
        ? "matter"
        : ["matter", "three-boson", "four-boson"].includes(savedVertex)
          ? savedVertex
          : "matter";
  const [anchor, setAnchor] = useState<Element | null>(null);
  const descriptions: Record<string, { title: string; text: string }> = {
    fermion: {
      title: theory === "qcd" ? "Quark line" : "Charged fermion line",
      text: "The straight oriented line denotes a fermion field in a diagram. The arrow follows fermion flow. It is not a measured trajectory of a tiny object.",
    },
    boson: {
      title: theory === "qcd" ? "Gluon line" : "Photon line",
      text:
        theory === "qcd"
          ? "Curly lines conventionally denote gluons. Unlike the electromagnetic field, the non-Abelian gluon field has elementary self-couplings. Color indices and momentum labels are omitted here."
          : "Wavy lines conventionally denote photons. QED has a matter–photon interaction vertex; it has no elementary three- or four-photon vertex. Photon–photon scattering through charged-particle loops is a different process.",
    },
    vertex: {
      title:
        vertex === "matter"
          ? "Matter–gauge-field coupling"
          : vertex === "three-boson"
            ? "Three-gluon coupling"
            : "Four-gluon coupling",
      text:
        vertex === "matter"
          ? theory === "qcd"
            ? "The QCD interaction couples a quark, an antiquark and a gluon field. The two fermion legs are parts of the matter line; this is one interaction vertex, not a complete scattering event."
            : "The QED interaction couples two charged-fermion legs to a photon field. This is a single elementary vertex, not a complete physical scattering process."
          : "The non-Abelian field-strength term produces this elementary gluon self-interaction. The diagram displays the permitted coupling and its number of gluon legs, not a numerical probability or a complete scattering amplitude.",
    },
  };
  const detail = descriptions[selected] || descriptions.vertex;
  const branches =
    vertex === "matter"
      ? [{ x: 450, y: 60, label: theory === "qcd" ? "Gluon" : "Photon" }]
      : vertex === "three-boson"
        ? [
            { x: 450, y: 60, label: "Gluon" },
            { x: 220, y: 325, label: "Gluon" },
            { x: 680, y: 325, label: "Gluon" },
          ]
        : [
            { x: 240, y: 80, label: "Gluon" },
            { x: 660, y: 80, label: "Gluon" },
            { x: 240, y: 325, label: "Gluon" },
            { x: 660, y: 325, label: "Gluon" },
          ];
  const choose = (kind: string, element: Element) => {
    setSelected(kind);
    setAnchor(element);
  };
  return (
    <div
      className="scientific-model interaction-explorer"
      data-interaction-theory={theory}
      data-interaction-vertex={vertex}
    >
      <div className="model-orientation">
        <span className="model-live-dot" /> Compare the elementary interaction
        vertices. Click a line or the central vertex for its meaning.
      </div>
      <div className="model-mode-switch" aria-label="Gauge theory">
        <button
          aria-pressed={theory === "qed"}
          onClick={() => {
            setTheory("qed");
            setVertex("matter");
            setAnchor(null);
          }}
        >
          Electromagnetism · QED
        </button>
        <button
          aria-pressed={theory === "qcd"}
          onClick={() => {
            setTheory("qcd");
            setAnchor(null);
          }}
        >
          Strong interaction · QCD
        </button>
      </div>
      {theory === "qcd" && (
        <div className="model-mode-switch" aria-label="Allowed QCD vertices">
          {(
            [
              ["matter", "Quark–gluon"],
              ["three-boson", "Three gluons"],
              ["four-boson", "Four gluons"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              aria-pressed={vertex === kind}
              onClick={() => {
                setVertex(kind);
                setAnchor(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="science-viewport">
        <svg
          className="scientific-svg model-svg interaction-svg"
          viewBox="0 0 900 410"
          role="group"
          aria-label={`${theory.toUpperCase()} ${vertex} elementary vertex diagram`}
        >
          <title>{detail.title}</title>
          <desc>
            Schematic diagram conventions: straight arrowed fermion lines, wavy
            photon lines, curly gluon lines. This is an interaction vertex, not
            a particle trajectory or a full scattering diagram.
          </desc>
          <defs>
            <marker
              id={marker}
              markerUnits="userSpaceOnUse"
              viewBox="0 0 12 12"
              markerWidth="12"
              markerHeight="12"
              refX="6"
              refY="6"
              orient="auto"
            >
              <path d="M1 1L11 6L1 11Z" fill="context-stroke" />
            </marker>
          </defs>
          {vertex === "matter" && (
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect fermion line"
              className={`vertex-fermion ${selected === "fermion" ? "is-selected" : ""}`}
              onClick={(event) => choose("fermion", event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose("fermion", event.currentTarget);
                }
              }}
            >
              <path
                d="M200 315L325 265L450 215L575 265L700 315"
                markerMid={`url(#${marker})`}
              />
              <path d="M200 315L450 215L700 315" className="vertex-hit-line" />
              <text x="198" y="358" textAnchor="middle">
                {theory === "qcd" ? "Quark" : "Charged fermion"}
              </text>
              <text x="703" y="358" textAnchor="middle">
                {theory === "qcd" ? "Quark" : "Charged fermion"}
              </text>
            </g>
          )}
          {branches.map((branch, index) => (
            <g
              key={index}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${branch.label.toLowerCase()} line ${index + 1}`}
              className={`vertex-boson ${theory} ${selected === "boson" ? "is-selected" : ""}`}
              onClick={(event) => choose("boson", event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose("boson", event.currentTarget);
                }
              }}
            >
              <path
                d={bosonPath(branch.x, branch.y, theory === "qcd")}
                className="vertex-boson-wave"
              />
              <path
                d={`M450 215L${branch.x} ${branch.y}`}
                className="vertex-hit-line"
              />
              <text
                x={branch.x}
                y={branch.y < 215 ? branch.y - 24 : branch.y + 39}
                textAnchor="middle"
              >
                {branch.label}
              </text>
            </g>
          ))}
          <g
            role="button"
            tabIndex={0}
            aria-label="Inspect interaction vertex"
            className="vertex-center"
            onClick={(event) => choose("vertex", event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                choose("vertex", event.currentTarget);
              }
            }}
          >
            <circle cx="450" cy="215" r="24" className="vertex-center-hit" />
            <circle cx="450" cy="215" r="8" />
          </g>
        </svg>
      </div>
      <div className="model-readout" aria-live="polite">
        <strong>{descriptions.vertex.title}</strong>
        <span>
          {theory === "qcd"
            ? vertex === "matter"
              ? "2 fermion legs + 1 gluon leg"
              : vertex === "three-boson"
                ? "3 gluon legs"
                : "4 gluon legs"
            : "2 charged-fermion legs + 1 photon leg"}
        </span>
      </div>
      <p className="vertex-summary">{descriptions.vertex.text}</p>
      <details className="model-assumptions">
        <summary>Diagram conventions and scope</summary>
        <p>{descriptions.boson.text}</p>
        <p>
          These are elementary interaction vertices in perturbation theory.
          External legs do not specify incoming/outgoing states, on-shell
          momenta, color factors or measured paths. A physical process requires
          a complete amplitude and appropriate states; this figure does not
          calculate cross sections or imply permanent bonds.
        </p>
        <p>
          Reference:{" "}
          <a
            href="https://pdg.lbl.gov/2021/reviews/rpp2021-rev-qcd.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Particle Data Group, Quantum Chromodynamics
          </a>
          .
        </p>
      </details>
      <SciencePopover
        anchor={anchor}
        title={detail.title}
        onClose={() => setAnchor(null)}
      >
        <p>{detail.text}</p>
      </SciencePopover>
    </div>
  );
}
