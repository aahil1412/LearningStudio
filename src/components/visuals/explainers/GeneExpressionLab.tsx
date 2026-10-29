import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import type { IllustrationSpec } from "../../../types";
import { useVisualRuntime, useVisualState } from "../../../lib/visualState";
import {
  AMINO_NAMES,
  AMINO_ACID_NAMES,
  DEFAULT_CODING_DNA,
  anticodonFor,
  compareMutation,
  geneTimeline,
  mutateDna,
  normalizeDna,
  templateFromCoding,
  translateCodingDna,
  translationWindow,
  type DnaBase,
  type GeneMutation,
} from "../../../lib/explainers/geneExpression";
import SciencePopover from "../SciencePopover";
import "./gene-expression.css";

type Part =
  | "dna"
  | "template"
  | "rna"
  | "polymerase"
  | "ribosome"
  | "trna"
  | "pairing"
  | "peptide";
type View = "transcription" | "translation" | "mutation";
const descriptions: Record<Part, { title: string; text: string }> = {
  dna: {
    title: "Coding DNA",
    text: "Read this strand from 5′ to 3′. Its sequence matches the RNA transcript except that DNA has T where RNA has U. The other DNA strand supplies the template.",
  },
  template: {
    title: "Template DNA",
    text: "RNA polymerase reads this strand from 3′ to 5′. Each template base selects a complementary RNA base: T→A, A→U, C→G and G→C.",
  },
  rna: {
    title: "Messenger RNA",
    text: "The growing RNA copy is built from 5′ to 3′, one nucleotide at a time. A nucleotide is a base together with its sugar and phosphate. The ribosome later reads groups of three RNA bases.",
  },
  polymerase: {
    title: "RNA polymerase",
    text: "This enzyme builds RNA by pairing incoming RNA nucleotides with the DNA template. The drawing represents its role and location; it is not an atomic structure.",
  },
  ribosome: {
    title: "Ribosome",
    text: "The ribosome reads an mRNA three bases at a time and joins amino acids into a chain. Each three-base group is a codon. It moves toward the RNA 3′ end.",
  },
  trna: {
    title: "Transfer RNA: an adaptor",
    text: "A tRNA carries an amino acid and uses its anticodon, a three-base RNA sequence, to match a codon. Pairing is complementary and antiparallel. This simplified view omits wobble pairing.",
  },
  pairing: {
    title: "Codon and anticodon",
    text: "The codon is shown 5′→3′; the complementary anticodon is shown 3′→5′. A pairs with U, and C pairs with G. A stop codon recruits a release factor rather than a tRNA carrying a stop amino acid.",
  },
  peptide: {
    title: "A growing polypeptide",
    text: "Amino acids join in the order encoded by the RNA. The chain grows from its amino (N) end toward its carboxyl (C) end. This lab computes the sequence, not folding or protein function.",
  },
};
const validPart = (value: unknown): Part =>
  typeof value === "string" && Object.hasOwn(descriptions, value)
    ? (value as Part)
    : "dna";
const bounded = (value: unknown, min: number, max: number, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
function safeDna(value: unknown, fallback = DEFAULT_CODING_DNA) {
  try {
    return typeof value === "string" ? normalizeDna(value) : fallback;
  } catch {
    return fallback;
  }
}
function safeMutation(value: unknown, dna: string): GeneMutation | null {
  if (!value || typeof value !== "object") return null;
  const m = value as GeneMutation;
  if (
    !["substitution", "insertion", "deletion"].includes(m.kind) ||
    !Number.isInteger(m.position) ||
    typeof m.base !== "string"
  )
    return null;
  try {
    mutateDna(dna, m);
    return m;
  } catch {
    return null;
  }
}

export default function GeneExpressionLab({
  spec,
}: {
  spec: IllustrationSpec;
}) {
  const runtime = useVisualRuntime(),
    marker = useId().replaceAll(":", "");
  const initial = safeDna(spec.gene?.codingDna);
  const [referenceRaw, setReference] = useVisualState(
      "gene.reference",
      initial,
    ),
    reference = safeDna(referenceRaw, initial);
  const [mutationRaw, setMutation] = useVisualState<GeneMutation | null>(
      "gene.mutation",
      null,
    ),
    mutation = safeMutation(mutationRaw, reference);
  const current = useMemo(
    () => (mutation ? mutateDna(reference, mutation) : reference),
    [reference, mutation],
  );
  const original = useMemo(() => translateCodingDna(reference), [reference]);
  const translated = useMemo(() => translateCodingDna(current), [current]);
  const template = useMemo(() => templateFromCoding(current), [current]);
  const consequence = useMemo(
    () => compareMutation(reference, current, mutation || undefined),
    [reference, current, mutation],
  );
  const maximum = geneTimeline(translated);
  const [progressRaw, setProgress] = useVisualState("gene.progress", 0),
    progress = bounded(progressRaw, 0, maximum);
  const [viewRaw, setView] = useVisualState<View>("gene.view", "transcription"),
    view: View = ["transcription", "translation", "mutation"].includes(viewRaw)
      ? viewRaw
      : "transcription";
  const [labelsRaw, setLabels] = useVisualState("gene.labels", true),
    labels = labelsRaw !== false;
  const [windowRaw, setWindow] = useVisualState("gene.window", 0),
    windowStart = bounded(windowRaw, 0, Math.max(0, current.length - 1));
  const [selectedRaw, setSelected] = useVisualState<Part>(
      "gene.selected",
      "dna",
    ),
    selected = validPart(selectedRaw);
  const [playing, setPlaying] = useState(false),
    [anchor, setAnchor] = useState<Element | null>(null);
  const [editKind, setEditKind] =
      useState<GeneMutation["kind"]>("substitution"),
    [editPosition, setEditPosition] = useState(6),
    [editBase, setEditBase] = useState<DnaBase>("C");
  const [sequenceDraft, setSequenceDraft] = useState(reference),
    [issue, setIssue] = useState("");
  const visibleDna = current.slice(windowStart, windowStart + 18),
    x = (index: number) => 200 + (index - windowStart) * 36;
  const copied = Math.min(progress, current.length),
    translationStep = Math.max(0, progress - current.length);
  const polymeraseIndex = Math.max(0, Math.min(copied, current.length - 1));
  const polymeraseInWindow =
    polymeraseIndex >= windowStart && polymeraseIndex < windowStart + 18;
  const activeIndex = Math.min(
    Math.max(0, translationStep),
    Math.max(0, translated.codons.length - 1),
  );
  const activeCodon = translated.codons[activeIndex];
  const rnaWindow = translationWindow(translated, activeIndex);
  const codonStart = rnaWindow.codonStart;
  const shownCodons = rnaWindow.codons;
  const codonX = (index: number) => 170 + (index - codonStart) * 128;
  const activeX = codonX(activeIndex);
  const aminoCount = translated.codons
    .slice(0, translationStep)
    .filter((c) => c.amino !== "*").length;
  const shownPeptide =
    view === "mutation"
      ? translated.peptide
      : translated.peptide.slice(0, aminoCount);
  const done = progress >= maximum;
  const inspect = (
    part: Part,
    event: MouseEvent<SVGElement> | KeyboardEvent<SVGElement>,
  ) => {
    event.stopPropagation();
    setSelected(part);
    setAnchor(event.currentTarget);
  };
  const actionProps = (part: Part, visibleLabel?: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `Inspect ${visibleLabel || descriptions[part].title}`,
    "data-gene-part": part,
    onClick: (event: MouseEvent<SVGElement>) => inspect(part, event),
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        inspect(part, event);
      }
    },
  });
  const seek = (value: number) => {
    const next = bounded(value, 0, maximum);
    setProgress(next);
    if (next >= current.length) setView("translation");
    else {
      setView("transcription");
      setWindow(Math.floor(Math.max(0, next - 1) / 18) * 18);
    }
  };
  const reset = () => {
    setPlaying(false);
    setProgress(0);
    setView("transcription");
    setWindow(0);
    setAnchor(null);
  };
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") setPlaying(false);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (runtime?.visible === false || done) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => seek(progress + 1), 420);
    return () => clearTimeout(timer);
  }, [playing, progress, maximum, current.length, runtime?.visible, done]);
  const applyMutation = (
    base = editBase,
    position = editPosition - 1,
    kind = editKind,
  ) => {
    try {
      const change = {
        kind,
        position: bounded(
          position,
          0,
          kind === "insertion" ? reference.length : reference.length - 1,
        ),
        base,
      };
      const next = mutateDna(reference, change);
      setMutation(change);
      setPlaying(false);
      setProgress(geneTimeline(translateCodingDna(next)));
      setView("mutation");
      setAnchor(null);
      setIssue("");
    } catch (error) {
      setIssue(
        error instanceof Error
          ? error.message
          : "This edit could not be applied.",
      );
    }
  };
  let explanation: string;
  if (view === "mutation") explanation = consequence.explanation;
  else if (view === "transcription")
    explanation =
      copied === 0
        ? "Press Step. Watch the first DNA template base select an RNA base. RNA grows toward its 3′ end."
        : copied < current.length
          ? `RNA polymerase has copied ${copied} of ${current.length} bases. The next template base is ${template[copied]}; its matching RNA base will be ${translated.rna[copied]}.`
          : `The RNA copy is complete. Now follow the ribosome as it reads three RNA bases at a time.`;
  else if (translated.status === "no-start")
    explanation =
      "No AUG start codon is present in this sequence. This teaching model cannot begin translation. The RNA still exists; its presence does not guarantee a protein.";
  else if (done)
    explanation =
      translated.status === "terminated"
        ? "The stop codon recruited a release factor and the amino-acid chain is complete in this model. Stop is a signal, not an amino acid."
        : "The displayed sequence ended without an in-frame stop. The calculated chain is incomplete; this model does not invent the missing sequence.";
  else
    explanation =
      activeCodon?.amino === "*"
        ? "This codon signals stop. A release factor, rather than an amino-acid-carrying tRNA, ends translation."
        : `The ribosome is reading ${activeCodon?.rna || ""}. Its complementary anticodon is ${anticodonFor(activeCodon?.rna || "")}; the standard code assigns ${AMINO_ACID_NAMES[activeCodon?.amino || ""] || "an amino acid"} (${AMINO_NAMES[activeCodon?.amino || ""] || ""}).`;
  return (
    <div className="gene-lab scientific-model" data-explainer="gene-expression">
      <div className="gene-lead">
        <p>
          Copy a DNA message into RNA, then read it three bases at a time.
          Change a base to discover why some edits change the chain and others
          do not.
        </p>
        <span>
          {spec.gene?.label || "Synthetic teaching sequence"} · standard genetic
          code
        </span>
      </div>
      <div
        className="gene-view-tabs"
        role="group"
        aria-label="Gene expression view"
      >
        <button
          aria-pressed={view === "transcription"}
          onClick={() => {
            setPlaying(false);
            setView("transcription");
            setProgress(0);
            setWindow(0);
          }}
        >
          1. Copy DNA into RNA
        </button>
        <button
          aria-pressed={view === "translation"}
          onClick={() => {
            setPlaying(false);
            setView("translation");
            setProgress(current.length);
          }}
        >
          2. Build an amino-acid chain
        </button>
        <button
          aria-pressed={view === "mutation"}
          onClick={() => {
            setPlaying(false);
            setView("mutation");
            setProgress(maximum);
          }}
        >
          3. Change the message
        </button>
      </div>
      <div className="gene-narration" aria-live="polite">
        <strong>
          {view === "mutation"
            ? consequence.title
            : view === "transcription"
              ? "Watch the RNA grow"
              : "Watch the codon being read"}
        </strong>
        <p>{explanation}</p>
      </div>
      <div
        className="gene-canvas-wrap"
        tabIndex={0}
        role="region"
        aria-label="Interactive gene expression drawing"
      >
        {view === "transcription" ? (
          <svg
            className="gene-svg"
            viewBox="0 0 960 410"
            role="group"
            aria-label="Antiparallel DNA strands and growing RNA"
          >
            <defs>
              <marker
                id={marker + "arrow"}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto"
              >
                <path d="M0 0 10 5 0 10Z" fill="currentColor" />
              </marker>
            </defs>
            <g
              className="gene-strand-label"
              {...actionProps("dna", "Coding DNA 5′→3′")}
            >
              <text x="28" y="70">
                Coding DNA
              </text>{" "}
              <text x="28" y="101">
                5′→3′
              </text>
            </g>
            <g
              className="gene-strand-label"
              {...actionProps("template", "Template DNA 3′→5′")}
            >
              <text x="28" y="143">
                Template DNA
              </text>{" "}
              <text x="28" y="174">
                3′→5′
              </text>
            </g>
            <g {...actionProps("rna", "RNA copy 5′→3′")}>
              <text className="gene-strand-label" x="28" y="257">
                RNA copy
              </text>{" "}
              <text className="gene-strand-label" x="28" y="288">
                5′→3′
              </text>
            </g>
            {visibleDna.split("").map((base, i) => {
              const index = windowStart + i;
              return (
                <g key={index} data-gene-base={index}>
                  <line
                    className="gene-pair"
                    x1={x(index) + 15}
                    y1="88"
                    x2={x(index) + 15}
                    y2="120"
                  />
                  <rect
                    className={`gene-base gene-base-${base}`}
                    x={x(index)}
                    y="48"
                    width="31"
                    height="42"
                    rx="6"
                  />
                  <text className="gene-letter" x={x(index) + 15.5} y="77">
                    {base}
                  </text>
                  <rect
                    className={`gene-base gene-base-${template[index]}`}
                    x={x(index)}
                    y="120"
                    width="31"
                    height="42"
                    rx="6"
                  />
                  <text className="gene-letter" x={x(index) + 15.5} y="149">
                    {template[index]}
                  </text>
                  <text className="gene-base-index" x={x(index) + 15.5} y="31">
                    {index + 1}
                  </text>
                  {index < copied ? (
                    <>
                      <rect
                        className={`gene-base gene-rna-base gene-base-${translated.rna[index]}`}
                        x={x(index)}
                        y="230"
                        width="31"
                        height="42"
                        rx="6"
                      />
                      <text className="gene-letter" x={x(index) + 15.5} y="259">
                        {translated.rna[index]}
                      </text>
                    </>
                  ) : (
                    <rect
                      className="gene-unmade-base"
                      x={x(index)}
                      y="230"
                      width="31"
                      height="42"
                      rx="6"
                    />
                  )}
                </g>
              );
            })}
            {polymeraseInWindow ? (
              <g
                {...actionProps("polymerase")}
                className="gene-polymerase"
                transform={`translate(${Math.min(800, x(polymeraseIndex))},200)`}
              >
                <path d="M-28-30 Q-46-5-22 24 L115 24 Q143-5 118-30Z" />
                <text x="47" y="-7" textAnchor="middle">
                  RNA
                </text>
                <text x="47" y="18" textAnchor="middle">
                  polymerase
                </text>
              </g>
            ) : (
              <text className="gene-helper-label" x="200" y="210">
                Polymerase at base {polymeraseIndex + 1}, outside this window.
              </text>
            )}
            {labels && (
              <>
                <path
                  className="gene-direction"
                  d="M180 327H770"
                  markerEnd={`url(#${marker}arrow)`}
                />
                <text className="gene-direction-label" x="180" y="365">
                  Template read 3′→5′; RNA synthesized 5′→3′
                </text>
              </>
            )}
          </svg>
        ) : (
          <svg
            className="gene-svg"
            viewBox="0 0 960 540"
            role="group"
            aria-label="Ribosome reads RNA codons and builds a polypeptide"
          >
            <g {...actionProps("peptide")}>
              <text className="gene-strand-label" x="28" y="48">
                {shownPeptide.length > 10
                  ? "Chain tail: N→C"
                  : "Chain so far: N→C"}
              </text>
              {shownPeptide.length ? (
                shownPeptide
                  .slice(-10)
                  .split("")
                  .map((amino, index) => (
                    <g
                      key={index}
                      transform={`translate(${310 + index * 58},44)`}
                    >
                      {index > 0 && (
                        <line
                          className="gene-peptide-link"
                          x1="-35"
                          x2="-22"
                          y1="0"
                          y2="0"
                        />
                      )}
                      <circle className="gene-amino" r="23" />
                      <text className="gene-amino-text" y="7">
                        {AMINO_NAMES[amino]}
                      </text>
                    </g>
                  ))
              ) : (
                <text className="gene-helper-label" x="310" y="49">
                  No amino acids joined yet
                </text>
              )}
            </g>
            <text className="gene-helper-label" x="28" y="92">
              Computed sequence; chain attachment not shown.
            </text>
            <g
              className="gene-translation-mechanism"
              transform="translate(0,40)"
            >
              {activeCodon && (
                <>
                  <g {...actionProps("ribosome")}>
                    <path
                      className="gene-ribosome"
                      d={`M${activeX - 43} 318 L${activeX - 43} 228 Q${activeX - 20} 173 ${activeX + 55} 173 Q${activeX + 150} 173 ${activeX + 160} 238 L${activeX + 160} 350 Q${activeX + 73} 389 ${activeX - 43} 350Z`}
                    />
                    {labels && (
                      <>
                        <text className="gene-strand-label" x="28" y="211">
                          Ribosome
                        </text>
                        <line
                          className="gene-callout"
                          x1="28"
                          x2={activeX - 53}
                          y1="228"
                          y2="248"
                        />
                      </>
                    )}
                  </g>
                  {activeCodon.amino !== "*" &&
                  !(done && translated.status === "terminated") ? (
                    <g
                      {...actionProps("trna")}
                      transform={`translate(${activeX + 56},0)`}
                    >
                      <path
                        className="gene-trna"
                        d="M-12 281V253Q-60 224-45 207Q-32 195-13 210V165Q-63 149-44 128Q-28 113-10 134Q9 113 27 131Q44 151 9 167V210Q34 194 48 211Q61 229 11 254V281Z"
                      />
                      <line
                        className="gene-amino-attachment"
                        x1="8"
                        y1="132"
                        x2="8"
                        y2="100"
                      />
                      <circle className="gene-amino" cx="8" cy="89" r="23" />
                      <text className="gene-amino-text" x="8" y="96">
                        {AMINO_NAMES[activeCodon.amino]}
                      </text>
                      <g {...actionProps("pairing")}>
                        <text className="gene-anticodon" x="-65" y="307">
                          3′
                        </text>
                        {anticodonFor(activeCodon.rna)
                          .split("")
                          .map((base, index) => (
                            <g key={index}>
                              <text
                                className="gene-anticodon"
                                x={-28 + index * 28}
                                y="307"
                              >
                                {base}
                              </text>
                              <line
                                className="gene-codon-pair"
                                x1={-28 + index * 28}
                                x2={-28 + index * 28}
                                y1="311"
                                y2="327"
                              />
                            </g>
                          ))}
                        <text className="gene-anticodon" x="65" y="307">
                          5′
                        </text>
                      </g>
                      {labels && (
                        <>
                          <text className="gene-helper-label" x="45" y="104">
                            3′ end
                          </text>
                          <text
                            className="gene-helper-label"
                            x={activeX < 500 ? 139 : -115}
                            textAnchor={activeX < 500 ? "start" : "end"}
                            y="136"
                          >
                            tRNA adaptor
                          </text>
                          <line
                            className="gene-callout"
                            x1={activeX < 500 ? 122 : -100}
                            x2={activeX < 500 ? 45 : -45}
                            y1="142"
                            y2="158"
                          />
                        </>
                      )}
                    </g>
                  ) : (
                    <g {...actionProps("pairing")}>
                      <rect
                        className="gene-release"
                        x={activeX - 3}
                        y="215"
                        width="125"
                        height="85"
                        rx="15"
                      />
                      <text
                        className="gene-release-label"
                        x={activeX + 59}
                        y="248"
                      >
                        Release
                      </text>
                      <text
                        className="gene-release-label"
                        x={activeX + 59}
                        y="277"
                      >
                        factor
                      </text>
                    </g>
                  )}
                </>
              )}
              <g {...actionProps("rna")}>
                <line
                  className="gene-rna-backbone"
                  x1="145"
                  x2={
                    170 +
                    (activeCodon
                      ? shownCodons.length * 128 - 12
                      : Math.min(18, translated.rna.length) * 36)
                  }
                  y1="338"
                  y2="338"
                />
                {!activeCodon &&
                  translated.rna
                    .slice(0, 18)
                    .split("")
                    .map((base, index) => (
                      <g key={index}>
                        <rect
                          className="gene-codon"
                          x={170 + index * 36}
                          y="316"
                          width="31"
                          height="48"
                          rx="6"
                        />
                        <text
                          className="gene-codon-letter"
                          x={185 + index * 36}
                          y="348"
                        >
                          {base}
                        </text>
                      </g>
                    ))}
                {shownCodons.map((codon, index) => {
                  const actual = codonStart + index;
                  return (
                    <g key={codon.index} {...actionProps("pairing")}>
                      <rect
                        className={`gene-codon ${actual === activeIndex ? "is-active" : ""}`}
                        x={codonX(actual)}
                        y="316"
                        width="112"
                        height="48"
                        rx="7"
                      />
                      {codon.rna.split("").map((base, baseIndex) => (
                        <text
                          key={baseIndex}
                          className="gene-codon-letter"
                          x={codonX(actual) + 28 + baseIndex * 28}
                          y="348"
                        >
                          {base}
                        </text>
                      ))}
                      <text
                        className="gene-base-index"
                        x={codonX(actual) + 56}
                        y="395"
                      >
                        {codon.index + 1}–{codon.index + 3}
                      </text>
                    </g>
                  );
                })}
                <text className="gene-strand-label" x="28" y="344">
                  {rnaWindow.hiddenBefore ? "mRNA …" : "mRNA 5′"}
                </text>
                <text
                  className="gene-strand-label"
                  x={
                    178 +
                    (activeCodon
                      ? shownCodons.length * 128
                      : Math.min(18, translated.rna.length) * 36)
                  }
                  y="345"
                >
                  {rnaWindow.hiddenAfter ? "…" : "3′"}
                </text>
              </g>
              {labels && (
                <text className="gene-direction-label" x="165" y="442">
                  {activeCodon
                    ? "One codon = three RNA bases. Read 5′→3′."
                    : "RNA exists without an AUG start. No reading frame is selected."}
                </text>
              )}
              {!activeCodon && (
                <text className="gene-helper-label" x="250" y="225">
                  No AUG start codon: no chain produced in this model.
                </text>
              )}
              {(rnaWindow.hiddenBefore || rnaWindow.hiddenAfter) && (
                <text className="gene-helper-label" x="165" y="470">
                  RNA bases {rnaWindow.firstBase + 1}–{rnaWindow.endBase} of{" "}
                  {translated.rna.length}. Dots mark omitted RNA.
                </text>
              )}
            </g>
          </svg>
        )}
      </div>
      {view === "transcription" && current.length > 18 && (
        <div className="gene-window-controls">
          <button
            disabled={windowStart === 0}
            onClick={() => {
              setPlaying(false);
              setWindow(Math.max(0, windowStart - 18));
            }}
          >
            Earlier bases
          </button>
          <output>
            Bases {windowStart + 1}–{Math.min(current.length, windowStart + 18)}{" "}
            of {current.length}
          </output>
          <button
            disabled={windowStart + 18 >= current.length}
            onClick={() => {
              setPlaying(false);
              setWindow(windowStart + 18);
            }}
          >
            Later bases
          </button>
        </div>
      )}
      <div className="gene-transport">
        <button
          className="gene-play"
          onClick={() => {
            if (playing) {
              setPlaying(false);
              return;
            }
            if (done || view === "mutation") seek(0);
            setPlaying(true);
          }}
        >
          <span aria-hidden="true">
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </span>
          {playing ? "Pause" : "Play process"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            seek(done ? 0 : progress + 1);
          }}
        >
          <StepForward size={17} aria-hidden="true" />
          {done ? "Restart steps" : "Step"}
        </button>
        <button onClick={reset}>
          <RotateCcw size={17} aria-hidden="true" />
          Reset process
        </button>
        <label>
          <input
            type="checkbox"
            checked={labels}
            onChange={(event) => setLabels(event.target.checked)}
          />
          Show labels
        </label>
      </div>
      <label className="gene-scrubber">
        <span>
          Process position{" "}
          <output>
            {copied}/{current.length} RNA bases ·{" "}
            {Math.min(translationStep, translated.codons.length)}/
            {translated.codons.length} codons read
          </output>
        </span>
        <input
          type="range"
          aria-label="Gene process position"
          min="0"
          max={maximum}
          step="1"
          value={progress}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value));
          }}
        />
      </label>
      <section className="gene-experiment" aria-label="Mutation experiment">
        <h4>What changes if you edit one base?</h4>
        <p>
          Drag a base onto the original sequence, or select a position and use
          the controls. Each experiment starts from the same reference so the
          comparison is clear.
        </p>
        <div className="gene-base-palette" aria-label="DNA bases to drag">
          {(["A", "C", "G", "T"] as DnaBase[]).map((base) => (
            <button
              key={base}
              className={`gene-base-chip gene-base-${base}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/x-gene-base", base);
                event.dataTransfer.setData("text/plain", base);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => setEditBase(base)}
              aria-pressed={editBase === base}
              aria-label={`Choose ${base} nucleotide`}
            >
              {base}
            </button>
          ))}
          <span>Drag to substitute a base below.</span>
        </div>
        <div className="gene-edit-sequence" aria-label="Original DNA bases">
          {reference.split("").map((base, index) => (
            <button
              key={index}
              className={`gene-reference-base ${editPosition === index + 1 ? "is-selected" : ""} ${mutation?.position === index ? "is-mutated" : ""}`}
              aria-label={`Select original base ${index + 1}: ${base}`}
              aria-pressed={editPosition === index + 1}
              onClick={() => setEditPosition(index + 1)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped =
                  event.dataTransfer.getData("text/x-gene-base") ||
                  event.dataTransfer.getData("text/plain");
                if (/^[ACGT]$/.test(dropped)) {
                  setEditPosition(index + 1);
                  setEditKind("substitution");
                  setEditBase(dropped as DnaBase);
                  applyMutation(dropped as DnaBase, index, "substitution");
                }
              }}
            >
              <span>{base}</span>
              <small>{index + 1}</small>
            </button>
          ))}
        </div>
        <div className="gene-mutation-controls">
          <label>
            Edit
            <select
              aria-label="Mutation type"
              value={editKind}
              onChange={(event) =>
                setEditKind(event.target.value as GeneMutation["kind"])
              }
            >
              <option value="substitution">Substitute one base</option>
              <option value="insertion">Insert one base before position</option>
              <option value="deletion">Delete one base</option>
            </select>
          </label>
          <label>
            Original position
            <input
              aria-label="Mutation position"
              type="number"
              min="1"
              max={reference.length + (editKind === "insertion" ? 1 : 0)}
              value={editPosition}
              onChange={(event) =>
                setEditPosition(
                  bounded(
                    Number(event.target.value),
                    1,
                    reference.length + (editKind === "insertion" ? 1 : 0),
                    1,
                  ),
                )
              }
            />
          </label>
          <label>
            New base
            <select
              aria-label="Mutation base"
              value={editBase}
              disabled={editKind === "deletion"}
              onChange={(event) => setEditBase(event.target.value as DnaBase)}
            >
              {["A", "C", "G", "T"].map((base) => (
                <option key={base}>{base}</option>
              ))}
            </select>
          </label>
          <button className="gene-apply" onClick={() => applyMutation()}>
            Apply mutation
          </button>
          <button
            onClick={() => {
              setMutation(null);
              reset();
            }}
          >
            Restore original
          </button>
        </div>
        {mutation && (
          <div
            className="gene-consequence"
            role="status"
            data-mutation-effect={consequence.kind}
          >
            <strong>{consequence.title}</strong>
            <p>{consequence.explanation}</p>
          </div>
        )}
        <div className="gene-comparison" aria-label="Sequence comparison">
          <div>
            <strong>Reference RNA</strong>
            <span data-gene-reference-rna>{original.rna}</span>
            <strong>Reference chain</strong>
            <span data-gene-reference-peptide>
              {original.peptide
                .split("")
                .map((amino) => AMINO_NAMES[amino])
                .join(" · ") || "No start"}
            </span>
          </div>
          <div>
            <strong>Edited RNA</strong>
            <span data-gene-current-rna>{translated.rna}</span>
            <strong>Edited chain</strong>
            <span data-gene-current-peptide>
              {translated.peptide
                .split("")
                .map((amino) => AMINO_NAMES[amino])
                .join(" · ") || "No start"}
            </span>
          </div>
        </div>
        <details className="gene-sequence-editor">
          <summary>Try another coding DNA sequence</summary>
          <label>
            Coding strand, 5′→3′
            <textarea
              aria-label="Coding DNA sequence"
              value={sequenceDraft}
              maxLength={400}
              onChange={(event) => setSequenceDraft(event.target.value)}
            />
          </label>
          <button
            onClick={() => {
              try {
                const dna = normalizeDna(sequenceDraft);
                setReference(dna);
                setMutation(null);
                setEditPosition(1);
                setIssue("");
                reset();
              } catch (error) {
                setIssue(
                  error instanceof Error
                    ? error.message
                    : "Check the DNA sequence.",
                );
              }
            }}
          >
            Use sequence
          </button>
        </details>
        {issue && (
          <p className="gene-error" role="alert">
            {issue}
          </p>
        )}
      </section>
      {!anchor && (
        <p className="gene-restored-selection">
          Selected: <strong>{descriptions[selected].title}</strong>. Select a
          component to inspect it nearby.
        </p>
      )}
      <details className="gene-model-notes">
        <summary>Model assumptions and scientific sources</summary>
        <p>
          This synthetic coding-sequence model copies every displayed base,
          starts translation at the first AUG and uses NCBI standard code 1. A
          stop codon ends translation. It omits promoters, initiation context,
          introns/splicing, RNA processing, wobble, alternative genetic codes
          and coupled transcription/translation. A peptide sequence is not a
          prediction of folding, function or disease.
        </p>
        <p>
          <a
            href="https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi"
            target="_blank"
            rel="noreferrer"
          >
            NCBI standard genetic code
          </a>{" "}
          ·{" "}
          <a
            href="https://www.genome.gov/25020001/online-education-kit-bioinformatics-finding-genes"
            target="_blank"
            rel="noreferrer"
          >
            NHGRI: strands and reading frames
          </a>{" "}
          ·{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/books/NBK26887/"
            target="_blank"
            rel="noreferrer"
          >
            NCBI: RNA synthesis direction
          </a>
        </p>
      </details>
      <SciencePopover
        anchor={anchor}
        title={descriptions[selected].title}
        onClose={() => setAnchor(null)}
      >
        <p>{descriptions[selected].text}</p>
      </SciencePopover>
    </div>
  );
}
