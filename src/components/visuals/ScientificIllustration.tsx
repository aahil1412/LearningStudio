import ScientificScene from "./ScientificScene";
import { FieldExplorer, ProteinAggregation } from "./ScientificModels";
import InteractionVertices from "./InteractionVertices";
import GeneExpressionLab from "./explainers/GeneExpressionLab";
import OptimizationLab from "./explainers/OptimizationLab";
import ExperimentLab from "./explainers/ExperimentLab";
import SciencePopover from "./SciencePopover";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { IllustrationSpec } from "../../types";
import { useVisualRuntime, useVisualState } from "../../lib/visualState";
import "./scientific-illustrations.css";

const translationSteps = [
  "Recognize: the A-site tRNA anticodon pairs with the next mRNA codon.",
  "Join: the ribosome transfers the growing chain onto the amino acid on the A-site tRNA.",
  "Advance: after transfer, the ribosome moves one codon toward the mRNA 3′ end. The A-site tRNA moves to the P site for the next cycle.",
];

function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="14"
        markerHeight="14"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10Z" fill="context-stroke" />
      </marker>
    </defs>
  );
}
type TranslationPart =
  "ribosome" | "trna" | "rna" | "pairing" | "amino" | "attachment";
function Participant({
  part,
  selected,
  onInspect,
  children,
  className = "",
}: {
  part: TranslationPart;
  selected?: TranslationPart | "";
  onInspect?: (part: TranslationPart) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <g
      data-science-part={part}
      className={`${className} ${onInspect ? "science-interactive" : ""} ${selected === part ? "science-selected" : ""}`}
      role={onInspect ? "button" : undefined}
      tabIndex={onInspect ? 0 : undefined}
      aria-label={
        onInspect
          ? `Inspect ${part === "rna" ? "mRNA" : part === "trna" ? "tRNA" : part === "amino" ? "amino acids" : part === "attachment" ? "amino-acid attachment" : part}`
          : undefined
      }
      onClick={
        onInspect
          ? (event) => {
              event.stopPropagation();
              onInspect(part);
            }
          : undefined
      }
      onKeyDown={
        onInspect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onInspect(part);
              }
            }
          : undefined
      }
    >
      {children}
    </g>
  );
}
function Trna({
  x,
  anticodon,
  amino,
  chain,
  active,
  selected,
  onInspect,
}: {
  x: number;
  anticodon: string;
  amino?: string;
  chain?: "Ala" | "Met";
  active: boolean;
  selected?: TranslationPart | "";
  onInspect?: (part: TranslationPart) => void;
}) {
  return (
    <g
      className={`science-trna ${active ? "science-emphasis" : ""}`}
      transform={`translate(${x} 0)`}
    >
      <Participant part="trna" selected={selected} onInspect={onInspect}>
        <path
          d="M-16 374 V356 L-40 340 Q-60 323 -42 310 L-16 322 V286 L-32 273 Q-47 251 -27 240 Q-12 230 0 242 Q12 230 27 240 Q47 251 32 273 L16 286 V322 L42 310 Q60 323 40 340 L16 356 V374 Q0 391 -16 374Z"
          className="science-trna-body"
        />
        <path d="M16 286 V195" className="science-trna-stem" />
        <path
          d="M-12 380 L-28 389 M0 383 V389 M12 380 L28 389"
          className="science-base-attachment"
        />
      </Participant>
      <Participant part="pairing" selected={selected} onInspect={onInspect}>
        {anticodon.split(" ").map((base, index) => (
          <text
            key={index}
            x={(index - 1) * 28}
            y="418"
            textAnchor="middle"
            className="science-base"
          >
            {base}
          </text>
        ))}
        <text x="-70" y="418" className="science-small">
          3′
        </text>
        <text x="51" y="418" className="science-small">
          5′
        </text>
      </Participant>
      {amino && (
        <Participant part="amino" selected={selected} onInspect={onInspect}>
          {chain && (
            <>
              <path d="M-30 140 L-4 160" className="science-connector" />
              <circle cx="-50" cy="125" r="30" className="science-amino" />
              <text
                x="-50"
                y="132"
                textAnchor="middle"
                className="science-residue"
              >
                {chain}
              </text>
              {chain === "Met" && (
                <>
                  <path d="M-73 114 L-89 106" className="science-connector" />
                  <circle cx="-112" cy="95" r="30" className="science-amino" />
                  <text
                    x="-112"
                    y="102"
                    textAnchor="middle"
                    className="science-residue"
                  >
                    Ala
                  </text>
                </>
              )}
            </>
          )}
          <circle cx="16" cy="175" r="30" className="science-amino" />
          <text x="16" y="182" textAnchor="middle" className="science-residue">
            {amino}
          </text>
        </Participant>
      )}
    </g>
  );
}

export function TranslationIllustration({
  step = 0,
  id = "translation-arrow",
  selected = "",
  onInspect,
}: {
  step?: number;
  id?: string;
  selected?: TranslationPart | "";
  onInspect?: (part: TranslationPart) => void;
}) {
  const joined = step >= 1,
    advanced = step === 2;
  const chainX = advanced ? 350 : joined ? 550 : 350;
  return (
    <svg
      className="scientific-svg translation-svg"
      data-science-template="translation"
      viewBox="0 0 900 690"
      xmlns="http://www.w3.org/2000/svg"
      role={onInspect ? "group" : "img"}
      aria-label="Translation: intact tRNAs pair anticodons with mRNA codons inside a ribosome; all explanatory labels sit outside the structures"
    >
      <Arrow id={id} />
      <Participant part="ribosome" selected={selected} onInspect={onInspect}>
        <path
          d="M230 447 L230 365 C210 285 246 223 316 212 C380 192 440 209 475 202 C574 171 675 256 680 363 L680 447Z"
          className="science-ribosome"
        />
        <path
          d="M240 492 Q450 548 670 492 H240Z"
          className="science-ribosome-small"
        />
      </Participant>
      <g data-science-layer="binding-sites">
        <rect
          x="260"
          y="268"
          width="180"
          height="160"
          rx="20"
          className="science-site"
        />
        <rect
          x="460"
          y="268"
          width="180"
          height="160"
          rx="20"
          className="science-site"
        />
      </g>
      {!advanced && (
        <g data-science-layer="peptidyl-trna">
          <Trna
            x={350}
            anticodon="U A C"
            amino={joined ? undefined : "Met"}
            chain={joined ? undefined : "Ala"}
            active={false}
            selected={selected}
            onInspect={onInspect}
          />
          {joined && (
            <path
              d="M366 175 C410 160 470 153 524 169"
              className="science-transfer"
              markerEnd={`url(#${id})`}
            />
          )}
        </g>
      )}
      <Trna
        x={advanced ? 350 : 550}
        anticodon="A A G"
        amino="Phe"
        chain={joined ? "Met" : undefined}
        active={!advanced}
        selected={selected}
        onInspect={onInspect}
      />
      <defs>
        <clipPath id={`${id}-strand`}>
          <rect x="64" y="443" width="770" height="52" />
        </clipPath>
      </defs>
      <Participant part="rna" selected={selected} onInspect={onInspect}>
        <g clipPath={`url(#${id}-strand)`}>
          <g transform={advanced ? "translate(-200 0)" : undefined}>
            <path d="M72 470 H1032" className="science-mrna" />
            {[
              { x: 150, bases: "G C U" },
              { x: 350, bases: "A U G" },
              { x: 550, bases: "U U C" },
              { x: 750, bases: "G G C" },
            ].map((c) => (
              <g key={c.x}>
                <rect
                  x={c.x - 72}
                  y="448"
                  width="144"
                  height="44"
                  rx="7"
                  className="science-codon"
                />
                {c.bases.split(" ").map((base, index) => (
                  <text
                    key={index}
                    x={c.x + (index - 1) * 28}
                    y="479"
                    textAnchor="middle"
                    className="science-base"
                  >
                    {base}
                  </text>
                ))}
              </g>
            ))}
          </g>
        </g>
        <text x="22" y="480" className="science-label">
          5′
        </text>
        <text x="853" y="480" className="science-label">
          3′
        </text>
      </Participant>
      <Participant
        part="pairing"
        selected={selected}
        onInspect={onInspect}
        className="science-pairing"
      >
        {(advanced ? [322, 350, 378] : [322, 350, 378, 522, 550, 578]).map(
          (x) => (
            <path key={x} d={`M${x} 431 V447`} />
          ),
        )}
      </Participant>
      <g data-science-layer="external-annotations">
        <Participant part="amino" selected={selected} onInspect={onInspect}>
          <text x="28" y="42" className="science-label">
            Growing chain
          </text>
          <text x="28" y="74" className="science-small">
            amino acids joined
          </text>
          <text x="28" y="116" className="science-small">
            Growth: N → C
          </text>
          <path
            d={
              advanced
                ? "M195 85 V95 H208"
                : `M245 86 H${joined ? chainX - 150 : 260} V${joined ? 95 : 125} H${joined ? chainX - 142 : 270}`
            }
            className="science-leader"
          />
          <text x="714" y="54" className="science-label">
            Amino acid
          </text>
          <path
            d={`M704 69 H${advanced ? 630 : 630} V175 H${advanced ? 390 : 590}`}
            className="science-leader"
          />
        </Participant>
        <Participant
          part="attachment"
          selected={selected}
          onInspect={onInspect}
        >
          <text x="726" y="178" className="science-small">
            3′ CCA end
          </text>
          <text x="726" y="208" className="science-small">
            holds amino acid
          </text>
          <path
            d={`M709 214 H${advanced ? 635 : 635} V200 H${advanced ? 368 : 568}`}
            className="science-leader"
          />
        </Participant>
        <Participant part="trna" selected={selected} onInspect={onInspect}>
          <text x="28" y="267" className="science-label">
            tRNA
          </text>
          <text x="28" y="300" className="science-small">
            amino-acid carrier
          </text>
          <path d="M201 307 H260 V329 H290" className="science-leader" />
        </Participant>
        <Participant part="pairing" selected={selected} onInspect={onInspect}>
          <text x="28" y="370" className="science-label">
            Anticodon
          </text>
          <text x="28" y="402" className="science-small">
            reads a codon
          </text>
          <path d="M190 408 H260 V418 H274" className="science-leader" />
        </Participant>
        <Participant part="ribosome" selected={selected} onInspect={onInspect}>
          <text x="715" y="315" className="science-label">
            Ribosome
          </text>
          <text x="715" y="347" className="science-small">
            large subunit
          </text>
          <path d="M705 357 H683" className="science-leader" />
          <text x="715" y="522" className="science-small">
            small subunit
          </text>
          <path d="M705 504 H690 V500 H640" className="science-leader" />
        </Participant>
        <g className="science-site-label">
          <path d="M350 520 V528 M550 520 V528" className="science-leader" />
          <text x="350" y="552" textAnchor="middle" className="science-small">
            P site
          </text>
          <text x="550" y="552" textAnchor="middle" className="science-small">
            A site
          </text>
        </g>
        <Participant part="rna" selected={selected} onInspect={onInspect}>
          <text x="28" y="552" className="science-label">
            mRNA
          </text>
          <text x="28" y="582" className="science-small">
            3 bases = 1 codon
          </text>
        </Participant>
        <Participant part="pairing" selected={selected} onInspect={onInspect}>
          <text x="290" y="592" className="science-label">
            Codon–anticodon pairing
          </text>
          <text x="290" y="622" className="science-small">
            Complementary, opposite directions
          </text>
        </Participant>
        <path
          d="M666 578 H840"
          className="science-connector science-rna-arrow"
          markerEnd={`url(#${id})`}
        />
        <text x="666" y="622" className="science-small">
          Reading: 5′ → 3′
        </text>
        <text x="450" y="669" textAnchor="middle" className="science-small">
          Schematic, not to scale. Ala = alanine; Met = methionine; Phe =
          phenylalanine.
        </text>
      </g>
    </svg>
  );
}

export function MembraneIllustration({
  step = 0,
  id = "membrane-arrow",
}: {
  step?: number;
  id?: string;
}) {
  const outsideCount = step ? 4 : 6;
  const insideCount = step ? 4 : 2;
  const columns = Array.from({ length: 22 }, (_, i) => 28 + i * 35);
  const particlePositions = (count: number, center: number, top: number) =>
    Array.from({ length: count }, (_, i) => ({
      x: center - 48 + (i % 3) * 48,
      y: top + Math.floor(i / 3) * 34,
    }));
  return (
    <svg
      className="scientific-svg membrane-svg"
      data-science-template="membrane-transport"
      viewBox="0 0 800 570"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Two passive membrane transport routes: small nonpolar molecules diffuse through a phospholipid bilayer; selected particles cross through a membrane protein channel"
    >
      <Arrow id={id} />
      <g data-science-layer="route-labels">
        <text x="210" y="38" textAnchor="middle" className="science-label">
          Simple diffusion
        </text>
        <text x="575" y="38" textAnchor="middle" className="science-label">
          Facilitated diffusion
        </text>
        <text x="210" y="68" textAnchor="middle" className="science-small">
          Small nonpolar molecules, e.g. oxygen
        </text>
        <text x="575" y="68" textAnchor="middle" className="science-small">
          Selected particles use a channel
        </text>
        <text x="25" y="110" className="science-small">
          Outside
        </text>
        <text x="25" y="365" className="science-small">
          Inside
        </text>
      </g>
      <g data-science-layer="phospholipid-bilayer">
        <rect
          x="12"
          y="213"
          width="776"
          height="99"
          rx="8"
          className="science-membrane-core"
        />
        {columns
          .filter((x) => x < 515 || x > 630)
          .map((x) => (
            <g key={x} className="science-phospholipid">
              <path
                d={`M${x - 5} 227 l-4 16 l8 15 l-4 16 M${x + 5} 227 l4 16 l-8 15 l4 16 M${x - 5} 298 l-4 -16 l8 -15 M${x + 5} 298 l4 -16 l-8 -15`}
                className="science-lipid-tail"
              />
              <circle cx={x} cy="216" r="11" className="science-lipid" />
              <circle cx={x} cy="310" r="11" className="science-lipid" />
            </g>
          ))}
      </g>
      <g data-science-layer="selective-channel">
        <rect x="555" y="200" width="37" height="127" fill="var(--figure)" />
        <path
          d="M531 200 Q508 203 510 233 V291 Q508 325 531 327 H555 V200Z"
          className="science-channel"
        />
        <path
          d="M616 200 Q639 203 637 233 V291 Q639 325 616 327 H592 V200Z"
          className="science-channel"
        />
        <path
          d="M558 209 V319 M589 209 V319"
          className="science-channel-pore"
        />
      </g>
      <g data-science-layer="particles" className="science-direct-particles">
        {particlePositions(outsideCount, 210, 126).map((p, i) => (
          <circle
            key={`out-${i}`}
            cx={p.x}
            cy={p.y}
            r="9"
            className="science-oxygen"
          />
        ))}
        {particlePositions(insideCount, 210, 358).map((p, i) => (
          <circle
            key={`in-${i}`}
            cx={p.x}
            cy={p.y}
            r="9"
            className="science-oxygen"
          />
        ))}
      </g>
      <g data-science-layer="channel-particles">
        {particlePositions(outsideCount, 575, 126).map((p, i) => (
          <rect
            key={`out-${i}`}
            x={p.x - 9}
            y={p.y - 9}
            width="18"
            height="18"
            rx="4"
            className="science-solute"
          />
        ))}
        {particlePositions(insideCount, 575, 358).map((p, i) => (
          <rect
            key={`in-${i}`}
            x={p.x - 9}
            y={p.y - 9}
            width="18"
            height="18"
            rx="4"
            className="science-solute"
          />
        ))}
      </g>
      <g
        data-science-layer="net-flow-arrows"
        aria-label={
          step
            ? "Particles move both ways with no net flow"
            : "Net movement down the concentration gradient"
        }
      >
        <path
          d="M210 178 V335"
          className="science-connector science-rna-arrow"
          markerStart={step ? `url(#${id})` : undefined}
          markerEnd={`url(#${id})`}
        />
        <path
          d="M575 178 V335"
          className="science-connector science-channel-arrow"
          markerStart={step ? `url(#${id})` : undefined}
          markerEnd={`url(#${id})`}
        />
      </g>
      <g data-science-layer="annotation-band">
        <text x="210" y="427" textAnchor="middle" className="science-label">
          Through the lipid layer
        </text>
        <text x="575" y="427" textAnchor="middle" className="science-label">
          Through a membrane protein
        </text>
        <text x="400" y="469" textAnchor="middle" className="science-small">
          {step
            ? "Equal concentrations: no net flow."
            : "Net movement follows the concentration gradient."}
        </text>
        <path d="M28 321 H6 V505 H250" className="science-leader" />
        <text x="400" y="512" textAnchor="middle" className="science-label">
          Phospholipid bilayer
        </text>
        <text x="400" y="542" textAnchor="middle" className="science-small">
          Heads face water. Two layers of tails face inward.
        </text>
      </g>
    </svg>
  );
}

function ReactionIllustration({
  activation,
  change,
  unit,
  id,
}: {
  activation: number;
  change: number;
  unit: string;
  id: string;
}) {
  const low = Math.min(change, 0) - 12,
    high = activation + 20;
  const project = (energy: number) =>
    365 - ((energy - low) / (high - low)) * 300;
  const pts = Array.from({ length: 161 }, (_, i) => {
    const x = i / 160,
      t = x < 0.5 ? x * 2 : (x - 0.5) * 2,
      s = t * t * (3 - 2 * t);
    const energy =
      x < 0.5 ? activation * s : activation + (change - activation) * s;
    return `${100 + x * 600},${project(energy)}`;
  });
  return (
    <svg
      className="scientific-svg"
      viewBox="0 0 800 460"
      role="img"
      aria-label="Illustrative reaction-energy profile with a transition state and separately labeled activation energy and free-energy change"
    >
      <Arrow id={id} />
      <path
        d="M90 45 V375 H750"
        className="science-axis"
        markerEnd={`url(#${id})`}
      />
      <text
        x="28"
        y="240"
        transform="rotate(-90 28 240)"
        textAnchor="middle"
        className="science-small"
      >
        Free energy ({unit})
      </text>
      <text x="410" y="430" textAnchor="middle" className="science-label">
        Reaction progress (not elapsed time)
      </text>
      <polyline points={pts.join(" ")} className="science-energy" />
      <text x="125" y={project(0) + 30} className="science-label">
        Reactants
      </text>
      <text x="590" y={project(change) + 32} className="science-label">
        Products
      </text>
      <text
        x="405"
        y={project(activation) - 18}
        textAnchor="middle"
        className="science-label"
      >
        Transition state
      </text>
      <path
        d={`M300 ${project(0)} V${project(activation)}`}
        className="science-connector"
        markerEnd={`url(#${id})`}
      />
      <text
        x="133"
        y={(project(0) + project(activation)) / 2}
        className="science-small"
      >
        Barrier: {activation} {unit}
      </text>
      <path
        d={`M730 ${project(0)} V${project(change)}`}
        className="science-connector"
        markerEnd={`url(#${id})`}
      />
      <text
        x="535"
        y={(project(0) + project(change)) / 2 - 12}
        className="science-small"
      >
        ΔG = {change} {unit}
      </text>
    </svg>
  );
}

function ProcessIllustration({
  spec,
  step,
  id,
}: {
  spec: IllustrationSpec;
  step: number;
  id: string;
}) {
  const stages = spec.stages ?? [];
  return (
    <div className="science-process-panels">
      {stages.map((stage, i) => (
        <section
          key={stage.id}
          className={step === i ? "science-process-active" : ""}
        >
          <span className="science-process-index">{i + 1}</span>
          <h5>{stage.label}</h5>
          <p>{stage.description}</p>
          {i < stages.length - 1 && (
            <svg viewBox="0 0 80 30" role="img" aria-label="leads to">
              <Arrow id={`${id}-${i}`} />
              <path
                d="M5 15 H70"
                className="science-connector"
                markerEnd={`url(#${id}-${i})`}
              />
            </svg>
          )}
        </section>
      ))}
    </div>
  );
}

export default function ScientificIllustration({
  spec,
}: {
  spec: IllustrationSpec;
}) {
  const [step, setStep] = useVisualState("illustration.step", 0);
  const [playing, setPlaying] = useVisualState("illustration.playing", false);
  const [selected, setSelected] = useVisualState<TranslationPart | "">(
    "illustration.selection",
    "",
  );
  const runtime = useVisualRuntime();
  const [activation, setActivation] = useVisualState(
    "illustration.activation",
    spec.reaction?.activationEnergy ?? 60,
  );
  const [change, setChange] = useVisualState(
    "illustration.freeEnergyChange",
    spec.reaction?.freeEnergyChange ?? -20,
  );
  const id = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Element | null>(null);
  const steps =
    spec.template === "translation"
      ? translationSteps
      : spec.template === "membrane-transport"
        ? [
            "Both routes are passive: net movement follows the concentration gradient. The protein channel allows selected particles through the membrane.",
            "Equal concentrations: particles still move both ways, but there is no net flow. The double-ended arrows show this continuing motion.",
          ]
        : spec.template === "process"
          ? (spec.stages?.map((s) => s.description || s.label) ?? [])
          : [];
  const currentStep = Math.min(
    Math.max(0, step),
    Math.max(0, steps.length - 1),
  );
  useEffect(() => {
    if (playing !== true || !steps.length || runtime?.visible === false) return;
    const timer = setTimeout(() => {
      if (currentStep >= steps.length - 1) setPlaying(false);
      else setStep(currentStep + 1);
    }, 1800);
    return () => clearTimeout(timer);
  }, [
    playing,
    currentStep,
    steps.length,
    runtime?.visible,
    setStep,
    setPlaying,
  ]);
  const details: Record<TranslationPart, { title: string; text: string }> = {
    rna: {
      title: "mRNA: the ordered message",
      text: "The ribosome reads this messenger RNA from 5′ toward 3′. Each three-base codon specifies an amino acid or a stop signal. In this elongation example, AUG specifies methionine and UUC specifies phenylalanine.",
    },
    trna: {
      title: "tRNA: an adaptor",
      text: "One end of a transfer RNA recognizes a complementary mRNA codon. The other end carries an amino acid. Its complete cloverleaf outline stays visible here; these functional shapes are not atomic structures.",
    },
    ribosome: {
      title: "Ribosome: a coordinated two-part machine",
      text: "The small subunit helps position the mRNA and matching tRNAs. The large subunit catalyzes peptide-bond formation. The P site holds the growing-chain tRNA; the A site receives the next amino-acid tRNA.",
    },
    amino: {
      title: "Amino acids become a polypeptide",
      text:
        currentStep === 0
          ? "The P-site tRNA carries an alanine–methionine chain. A phenylalanine is attached to the incoming A-site tRNA. Choose Next step to see the chain transferred onto phenylalanine."
          : "The ribosome has joined alanine, methionine and phenylalanine. The chain is attached to the tRNA that brought phenylalanine. After translocation, that tRNA occupies the P site.",
    },
    attachment: {
      title: "The 3′ CCA attachment end",
      text: "An amino acid is attached at the 3′ end of the tRNA, which ends in CCA. Correct loading of tRNAs happens before this depicted decoding step. The label is outside the structure so it does not conceal the attachment.",
    },
    pairing: {
      title: "Codon and anticodon pair in opposite directions",
      text:
        currentStep === 2
          ? "The anticodon 3′ AAG 5′ remains paired with the codon 5′ UUC 3′ after the ribosome advances. The next codon, GGC, is now available to the A site."
          : "The mRNA codon 5′ AUG 3′ pairs with the tRNA anticodon 3′ UAC 5′. The next codon 5′ UUC 3′ pairs with 3′ AAG 5′. Complementary bases pair antiparallel; matching is not an identical sequence.",
    },
  };
  const inspected = selected && details[selected];
  return (
    <div
      className="scientific-illustration"
      ref={host}
      onClickCapture={(event) => {
        const part = (event.target as Element).closest?.("[data-science-part]");
        if (part && selected !== undefined) setAnchor(part);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          const part = (event.target as Element).closest?.(
            "[data-science-part]",
          );
          if (part) setAnchor(part);
        }
      }}
    >
      {spec.template === "translation" && (
        <div className="science-inspector" aria-live="polite">
          {inspected && !anchor ? (
            <>
              <strong>{inspected.title}</strong>
              <p>{inspected.text}</p>
              <button onClick={() => setSelected("")}>Clear focus</button>
            </>
          ) : (
            <p>
              Select the mRNA, a tRNA, an amino acid or the ribosome to inspect
              its role. Use Play sequence or Next step to follow the mechanism.
            </p>
          )}
        </div>
      )}
      {spec.template === "gene-expression-lab" ? (
        <GeneExpressionLab spec={spec} />
      ) : spec.template === "optimization-lab" ? (
        <OptimizationLab spec={spec} />
      ) : spec.template === "experiment" ? (
        <ExperimentLab spec={spec} />
      ) : spec.template === "field-explorer" ? (
        <FieldExplorer spec={spec} />
      ) : spec.template === "protein-aggregation" ? (
        <ProteinAggregation spec={spec} />
      ) : spec.template === "interaction-vertices" ? (
        <InteractionVertices spec={spec} />
      ) : spec.template === "scene" ? (
        <ScientificScene spec={spec} />
      ) : (
        <div className="science-viewport">
          {spec.template === "translation" ? (
            <TranslationIllustration
              step={currentStep}
              id={id}
              selected={selected}
              onInspect={setSelected}
            />
          ) : spec.template === "membrane-transport" ? (
            <MembraneIllustration step={currentStep} id={id} />
          ) : spec.template === "reaction-energy" ? (
            <ReactionIllustration
              activation={Math.max(activation, change + 1)}
              change={change}
              unit={spec.reaction?.unit ?? "relative units"}
              id={id}
            />
          ) : (
            <ProcessIllustration spec={spec} step={currentStep} id={id} />
          )}
        </div>
      )}
      {steps.length > 0 && (
        <div className="science-step-controls" aria-label="Illustration steps">
          <button
            aria-label={
              playing
                ? "Pause illustration playback"
                : "Play illustration playback"
            }
            aria-pressed={playing === true}
            onClick={() => {
              if (!playing && currentStep === steps.length - 1) setStep(0);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause" : "Play sequence"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
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
              setPlaying(false);
              setStep(Math.min(steps.length - 1, currentStep + 1));
            }}
            disabled={currentStep === steps.length - 1}
          >
            Next step
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setStep(0);
              setSelected("");
            }}
          >
            Reset
          </button>
          <p aria-live="polite">{steps[currentStep]}</p>
        </div>
      )}
      {spec.template === "reaction-energy" && (
        <div className="science-step-controls">
          <p>
            This is an illustrative energy landscape, not a computed molecular
            reaction or measured data.
          </p>
          <label>
            Activation energy ({spec.reaction?.unit ?? "relative units"}){" "}
            <output>{Math.max(activation, change + 1)}</output>
            <input
              aria-label="Illustration activation energy"
              type="range"
              min={Math.max(10, change + 1)}
              max={200}
              step={1}
              value={Math.max(activation, change + 1)}
              onChange={(e) => setActivation(Number(e.target.value))}
            />
          </label>
          <label>
            Free-energy change ({spec.reaction?.unit ?? "relative units"}){" "}
            <output>{change}</output>
            <input
              aria-label="Illustration free-energy change"
              type="range"
              min={-100}
              max={100}
              step={1}
              value={change}
              onChange={(e) => setChange(Number(e.target.value))}
            />
          </label>
        </div>
      )}
      {spec.caption && <p className="visual-caption">{spec.caption}</p>}
      {spec.template === "translation" && (
        <p className="visual-caption">
          Scientific references:{" "}
          <a
            href="https://www.genome.gov/genetics-glossary/Translation"
            target="_blank"
            rel="noreferrer"
          >
            NHGRI translation
          </a>
          ,{" "}
          <a
            href="https://www.genome.gov/genetics-glossary/Anticodon"
            target="_blank"
            rel="noreferrer"
          >
            anticodon
          </a>
          ,{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/books/NBK26829/"
            target="_blank"
            rel="noreferrer"
          >
            Molecular Biology of the Cell, RNA to protein
          </a>
          . Original Learning Studio schematic. Functional shapes represent
          relationships, not atomic structures. Initiation, release factors,
          elongation factors, and energy consumption are omitted from this
          two-codon elongation view.
        </p>
      )}
      {spec.template === "translation" && inspected && (
        <SciencePopover
          anchor={anchor}
          title={inspected.title}
          onClose={() => setAnchor(null)}
        >
          <p>{inspected.text}</p>
        </SciencePopover>
      )}
      <div className="science-export">
        <button
          onClick={() => {
            const svg = host.current?.querySelector("svg");
            if (!svg) return;
            const clone = svg.cloneNode(true) as SVGSVGElement;
            const originals = svg.querySelectorAll("*");
            clone.querySelectorAll<SVGElement>("*").forEach((el, i) => {
              const css = getComputedStyle(originals[i]);
              el.style.fill = css.fill;
              el.style.stroke = css.stroke;
              el.style.fontFamily = css.fontFamily;
              el.style.fontSize = css.fontSize;
              el.style.fontWeight = css.fontWeight;
              el.style.strokeWidth = css.strokeWidth;
              el.style.strokeDasharray = css.strokeDasharray;
              el.style.strokeLinecap = css.strokeLinecap;
              el.style.strokeLinejoin = css.strokeLinejoin;
              el.style.opacity = css.opacity;
            });
            clone.style.background = getComputedStyle(svg).backgroundColor;
            const a = document.createElement("a"),
              url = URL.createObjectURL(
                new Blob([new XMLSerializer().serializeToString(clone)], {
                  type: "image/svg+xml",
                }),
              );
            a.href = url;
            a.download = "learning-scientific-illustration.svg";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export illustration SVG
        </button>
      </div>
    </div>
  );
}
