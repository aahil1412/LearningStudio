import { chooseTeachingVisual } from "../../lib/tutorSkills";
import { Component, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import katex from "katex";
import StudioMarkdown from "../Markdown";
import type {
  ContentBlock,
  DiagramSpec,
  ImageResult,
  PlotSpec,
} from "../../types";
import {
  calculatePlot,
  initialParameters,
  layoutDiagram,
  plotControls,
  validateContentBlock,
} from "../../lib/visualSpecs";
import "./visuals.css";
import ScientificIllustration from "./ScientificIllustration";
import MCQView, { type MCQSubmit } from "./MCQView";
import {
  AdvancedPlotView,
  CustomMathLab,
  isAdvancedPlot,
} from "./AdvancedPlot";
import {
  ChemicalView,
  ChemistryLab,
  MolecularAdvancedPanel,
} from "./MolecularAdvanced";
import {
  atomicAngle,
  atomicTorsion,
  atomicDistance,
  atomPoint,
} from "../../lib/science/molecular";
import {
  createVisualThemeObserver,
  useVisualCheckpoint,
  useVisualRuntime,
  useVisualSource,
  useVisualState,
  useVisualCreator,
  useVisualSlot,
} from "../../lib/visualState";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The visualization could not be loaded.";
}
function ScientificText({ text }: { text: string }) {
  return <StudioMarkdown text={text} />;
}
function saveFile(data: string, name: string, type: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([data], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FigureFrame({
  title,
  tag,
  children,
  tools,
}: {
  title: string;
  tag: string;
  children: ReactNode;
  tools?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const runtime = useVisualRuntime();
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);
  return (
    <section
      className={`visual-figure ${expanded ? "visual-expanded" : ""}`}
      aria-label={title}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
    >
      <header className="visual-figure-header">
        <div>
          <h4>{title}</h4>
          <span className="visual-tag">{tag}</span>
        </div>
        <div className="visual-toolbar">
          {tools}
          <button
            type="button"
            title={expanded ? "Exit fullscreen (Esc)" : "Expand visualization"}
            aria-label={expanded ? "Exit fullscreen" : "Expand visualization"}
            onClick={() =>
              runtime
                ? runtime.move(
                    runtime.placement === "fullscreen"
                      ? "inline"
                      : "fullscreen",
                  )
                : setExpanded((v) => !v)
            }
          >
            {expanded ? "↙" : "↗"}
          </button>
        </div>
      </header>
      {children}
    </section>
  );
}
class VisualBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="visual-error" role="status">
        This figure could not be rendered. Your lesson is still available.{" "}
        <button onClick={() => this.setState({ error: false })}>
          Try again
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function DiagramView({
  spec,
  onExplain,
}: {
  spec: DiagramSpec;
  onExplain?: (text: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const marker = useId().replace(/:/g, "");
  const { width, height, positions } = useMemo(
    () => layoutDiagram(spec),
    [spec],
  );
  const [zoom, setZoom] = useVisualState("diagram.zoom", 1);
  const [pan, setPan] = useVisualState("diagram.pan", { x: 0, y: 0 });
  const [selected, setSelected] = useVisualState("diagram.selected", "");
  const drag = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const node = spec.nodes.find((n) => n.id === selected);
  const begin = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as SVGElement).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const exportSvg = () => {
    if (!svg.current) return;
    const copy = svg.current.cloneNode(true) as SVGSVGElement;
    const css = getComputedStyle(svg.current);
    copy.style.color = css.color;
    copy.style.background = css.backgroundColor;
    copy.querySelectorAll<SVGElement>("*").forEach((el, i) => {
      const original = svg.current!.querySelectorAll<SVGElement>("*")[i];
      if (original) {
        const style = getComputedStyle(original);
        el.style.fill = style.fill;
        el.style.stroke = style.stroke;
        el.style.fontFamily = style.fontFamily;
        el.style.fontSize = style.fontSize;
      }
    });
    saveFile(
      new XMLSerializer().serializeToString(copy),
      "learning-diagram.svg",
      "image/svg+xml",
    );
  };
  return (
    <FigureFrame
      title={spec.title}
      tag="Diagram"
      tools={
        <button onClick={exportSvg} title="Export SVG" aria-label="Export SVG">
          ↓
        </button>
      }
    >
      <div className="diagram-tools">
        <span>Drag to pan · select a concept</span>
        <button
          aria-label="Zoom diagram out"
          onClick={() => setZoom((v) => Math.max(0.5, v - 0.2))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom diagram in"
          onClick={() => setZoom((v) => Math.min(3, v + 0.2))}
        >
          +
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>
      <div className="diagram-viewport">
        <svg
          className="diagram-canvas"
          ref={svg}
          xmlns="http://www.w3.org/2000/svg"
          role="group"
          aria-label={spec.title}
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: Math.round(width * 0.9) }}
          onPointerDown={begin}
          onPointerMove={(e) => {
            if (drag.current) {
              setPan({
                x:
                  drag.current.panX +
                  ((e.clientX - drag.current.x) * width) /
                    (svg.current?.clientWidth ?? width),
                y:
                  drag.current.panY +
                  ((e.clientY - drag.current.y) * height) /
                    (svg.current?.clientHeight ?? height),
              });
            }
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="diagram-arrow" />
            </marker>
          </defs>
          <g
            transform={`translate(${width / 2 + pan.x} ${height / 2 + pan.y}) scale(${zoom}) translate(${-width / 2} ${-height / 2})`}
          >
            {spec.edges.map((edge, i) => {
              const a = positions.get(edge.from),
                b = positions.get(edge.to);
              if (!a || !b) return null;
              const same = a.y === b.y;
              const sx = same ? a.x + 78 : a.x,
                sy = same ? a.y : a.y + 27,
                ex = same ? b.x - 83 : b.x,
                ey = same ? b.y : b.y - 32;
              return (
                <g key={i}>
                  <path
                    d={`M${sx} ${sy} C ${sx} ${(sy + ey) / 2}, ${ex} ${(sy + ey) / 2}, ${ex} ${ey}`}
                    fill="none"
                    className="diagram-edge"
                    markerEnd={`url(#${marker})`}
                  />
                  {edge.label && (
                    <text
                      className="diagram-edge-label"
                      x={(sx + ex) / 2 + 7}
                      y={(sy + ey) / 2 - 7}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
            {spec.nodes.map((n) => {
              const p = positions.get(n.id)!;
              const words =
                n.label.length > 22 ? n.label.split(" ") : [n.label];
              const lines: string[] = [];
              for (const word of words) {
                if (
                  lines.length &&
                  lines[lines.length - 1].length + word.length < 24
                )
                  lines[lines.length - 1] += " " + word;
                else lines.push(word);
              }
              return (
                <g
                  key={n.id}
                  data-node={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Explain ${n.label}`}
                  className={`diagram-node ${selected === n.id ? "is-selected" : ""}`}
                  onClick={() => setSelected(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelected(n.id);
                  }}
                >
                  <rect
                    x={p.x - 80}
                    y={p.y - 28}
                    width="160"
                    height="56"
                    rx="10"
                  />
                  <text
                    x={p.x}
                    y={p.y - (lines.length - 1) * 7 + 4}
                    textAnchor="middle"
                  >
                    {lines.slice(0, 3).map((line, i) => (
                      <tspan key={i} x={p.x} dy={i ? 15 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {node && (
        <div className="diagram-detail">
          <strong>{node.label}</strong>
          <p>
            {node.detail ??
              "Explore how this concept connects to the surrounding ideas."}
          </p>
          {onExplain && (
            <button
              onClick={() =>
                onExplain(
                  `Explain ${node.label} in the context of ${spec.title}.`,
                )
              }
            >
              Ask the tutor about this
            </button>
          )}
        </div>
      )}
    </FigureFrame>
  );
}

let plotlyPromise: Promise<any> | null = null;
function loadPlotly() {
  plotlyPromise ??= import("plotly.js-basic-dist-min").then(
    (m) => m.default ?? m,
  );
  return plotlyPromise;
}
export function PlotView({ spec }: { spec: PlotSpec }) {
  const container = useRef<HTMLDivElement>(null);
  const plot = useRef<any>(null);
  const [values, setValues] = useVisualState("plot.parameters", () =>
    initialParameters(spec),
  );
  const [playing, setPlaying] = useVisualState("plot.playing", false);
  const [savedLayout, setSavedLayout] = useVisualState<Record<string, unknown>>(
    "plot.layout",
    {},
  );
  const savedLayoutRef = useRef(savedLayout);
  savedLayoutRef.current = savedLayout;
  const runtime = useVisualRuntime(),
    runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const initialSpec = useRef(JSON.stringify(spec)),
    listener = useRef<((value: unknown) => void) | null>(null);
  const readLayout = () => {
    const layout = (container.current as any)?.layout;
    return layout
      ? {
          xaxis: {
            range: layout.xaxis?.range,
            autorange: layout.xaxis?.autorange,
          },
          yaxis: {
            range: layout.yaxis?.range,
            autorange: layout.yaxis?.autorange,
          },
          dragmode: layout.dragmode,
        }
      : undefined;
  };
  useVisualCheckpoint("plot.layout", readLayout);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const first = plotControls[spec.kind][0];
  useEffect(() => {
    if (initialSpec.current === JSON.stringify(spec)) return;
    initialSpec.current = JSON.stringify(spec);
    setValues(initialParameters(spec));
    setPlaying(false);
  }, [spec]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    const tick = (time: number) => {
      if (time - previous > 90) {
        setValues((v) => ({
          ...v,
          [first.key]:
            v[first.key] + first.step > first.max
              ? first.min
              : v[first.key] + first.step,
        }));
        previous = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, first]);
  useEffect(() => {
    let alive = true;
    const element = container.current;
    if (!element) return;
    loadPlotly()
      .then(async (lib) => {
        if (!alive) return;
        plot.current = lib;
        const css = getComputedStyle(element);
        const accent = css.getPropertyValue("--accent").trim() || "#a3b8a1";
        const accent2 = css.getPropertyValue("--accent2").trim() || "#c99470";
        const text = css.getPropertyValue("--text").trim() || "#ddd";
        const background = css.getPropertyValue("--figure").trim() || "#242424";
        const border = css.getPropertyValue("--border").trim() || "#555";
        const traces = calculatePlot(spec, values).map((curve, i) => ({
          ...curve,
          type: "scatter",
          mode: "lines",
          line: {
            color: i ? accent2 : accent,
            width: 2.5,
            dash: i ? "dash" : "solid",
          },
        }));
        await lib.react(
          element,
          traces,
          {
            autosize: true,
            height: 290,
            margin: { l: 53, r: 18, t: 15, b: 57 },
            paper_bgcolor: background,
            plot_bgcolor: background,
            font: {
              color: text,
              size: 11,
              family:
                css.getPropertyValue("--ui-font").trim() ||
                "Segoe UI, sans-serif",
            },
            xaxis: {
              ...((savedLayoutRef.current.xaxis as Record<string, unknown>) ??
                {}),
              title: {
                text:
                  spec.xLabel ??
                  (spec.kind === "wave" || spec.kind === "oscillator"
                    ? "Time (s)"
                    : spec.kind === "logistic"
                      ? "Time (arbitrary units)"
                      : "x (dimensionless)"),
              },
              gridcolor: border,
              zerolinecolor: border,
            },
            yaxis: {
              ...((savedLayoutRef.current.yaxis as Record<string, unknown>) ??
                {}),
              title: {
                text:
                  spec.yLabel ??
                  (spec.kind === "gaussian"
                    ? "Density (1/x)"
                    : spec.kind === "logistic"
                      ? "Population (count)"
                      : "y (dimensionless)"),
              },
              gridcolor: border,
              zerolinecolor: border,
            },
            showlegend: traces.length > 1,
            legend: { orientation: "h", x: 0, y: -0.32 },
            uirevision: spec.kind,
            ...(typeof savedLayoutRef.current.dragmode === "string"
              ? { dragmode: savedLayoutRef.current.dragmode }
              : {}),
          },
          {
            responsive: true,
            displaylogo: false,
            scrollZoom: true,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
            toImageButtonOptions: {
              format: "svg",
              filename: "learning-studio-plot",
            },
          },
        );
        if (!listener.current && (element as any).on) {
          listener.current = () => {
            const layout = readLayout();
            if (layout) setSavedLayout(layout);
          };
          (element as any).on("plotly_relayout", listener.current);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [spec, values, revision]);
  useEffect(() => {
    const observer = createVisualThemeObserver(() => setRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    const element = container.current;
    const resize = new ResizeObserver(() => {
      if (element && element.clientWidth > 0 && plot.current)
        plot.current.Plots.resize(element);
    });
    if (element) resize.observe(element);
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (listener.current)
        (element as any)?.removeListener?.("plotly_relayout", listener.current);
      if (element && plot.current) plot.current.purge(element);
    };
  }, []);
  return (
    <FigureFrame
      title={spec.title}
      tag="Interactive plot"
      tools={
        <button
          aria-label="Export plot"
          title="Export plot as SVG"
          onClick={() => {
            if (plot.current && container.current)
              void plot.current.downloadImage(container.current, {
                format: "svg",
                filename: "learning-studio-plot",
              });
          }}
        >
          ↓
        </button>
      }
    >
      {error ? (
        <div className="visual-error">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              plotlyPromise = null;
              setRevision((v) => v + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          ref={container}
          className="plot-canvas"
          aria-label={`${spec.title} plot`}
        />
      )}
      <div className="plot-controls">
        {plotControls[spec.kind].map((c) => (
          <label key={c.key}>
            <span>
              {c.label}
              <output>{values[c.key]?.toFixed(2)}</output>
            </span>
            <input
              aria-label={c.label}
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={values[c.key] ?? c.initial}
              onChange={(e) =>
                setValues((v) => ({ ...v, [c.key]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
        <div className="visual-action-row">
          <button onClick={() => setPlaying((v) => !v)}>
            {playing ? "Pause" : "Animate"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setValues(initialParameters(spec));
              if (plot.current && container.current)
                plot.current.relayout(container.current, {
                  "xaxis.autorange": true,
                  "yaxis.autorange": true,
                });
            }}
          >
            Reset
          </button>
          <span>Deterministic calculation · drag to zoom</span>
        </div>
      </div>
    </FigureFrame>
  );
}

type StructureData = {
  data: string;
  format: string;
  sourceUrl?: string;
  name?: string;
};
let molPromise: Promise<any> | null = null;
function loadMol() {
  molPromise ??= import("3dmol/build/3Dmol.es6-min.js").then(
    (m) => m.default ?? m,
  );
  return molPromise;
}
export function MoleculeView({
  id,
  source,
  caption,
}: {
  id: string;
  source: "pdb" | "pubchem";
  caption?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<any>(null);
  const runtime = useVisualRuntime(),
    runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const [camera, setCamera] = useVisualState<number[] | null>(
      "molecule.camera",
      null,
    ),
    cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [selectedAtoms, setSelectedAtoms] = useVisualState<
      { serial: number; model: number }[]
    >("molecule.selectedAtoms", []),
    selectedAtomsRef = useRef(selectedAtoms);
  selectedAtomsRef.current = selectedAtoms;
  const cameraSavedAt = useRef(0);
  useVisualCheckpoint("molecule.camera", () => viewer.current?.getView());
  const [structure, setStructure] =
    useVisualSource<StructureData>("molecule.structure");
  const [comparison, setComparison] = useVisualSource<StructureData>(
    "molecule.comparison",
  );
  const [lookup, setLookup] = useVisualState("molecule.lookup", id);
  const [provider, setProvider] = useVisualState("molecule.provider", source);
  const [style, setStyle] = useVisualState("molecule.style", "cartoon");
  const [surface, setSurface] = useVisualState("molecule.surface", false);
  const [spinning, setSpinning] = useVisualState("molecule.spinning", false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useVisualState("molecule.selection", "");
  const [distance, setDistance] = useVisualState("molecule.measurement", "");
  const selected = useRef<any[]>([]);
  const selectAtom = useRef<(atom: any) => void>(() => {});
  const [atomSerial, setAtomSerial] = useVisualState(
    "molecule.atomSerial",
    "1",
  );
  const [revision, setRevision] = useState(0);
  const [depiction, setDepiction] = useState<{
    dataUrl: string;
    sourceUrl: string;
    id: string;
  } | null>(null);
  const [showDepiction, setShowDepiction] = useState(false);
  const [structureLabel, setStructureLabel] = useVisualState(
    "molecule.label",
    caption || `${source === "pdb" ? "PDB" : "PubChem"} · ${id}`,
  );
  const [frameData, setFrameData] = useState<string | null>(null);
  const [aligned, setAligned] = useVisualState("molecule.aligned", false);
  const [selectionMode, setSelectionMode] = useVisualState<
    "atom" | "residue" | "angle" | "torsion"
  >("molecule.selectionMode", "atom");
  async function fetchStructure(compare = false) {
    setLoading(true);
    setError("");
    try {
      if (!window.studio)
        throw new Error("Open the desktop application to retrieve structures.");
      const data = await window.studio.invoke<StructureData>(
        "structure:fetch",
        { source: provider, id: lookup.trim() },
      );
      if (compare) {
        setComparison(data);
        setAligned(false);
      } else {
        setCamera(null);
        setSelectedAtoms([]);
        setStructure(data);
        setStructureLabel(
          data.name ||
            `${provider === "pdb" ? "PDB" : "PubChem"} · ${lookup.trim()}`,
        );
        setComparison(null);
        setSelection("");
        setDistance("");
        setShowDepiction(false);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  // A block is an explicit structure request. No model call is needed.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    if (runtimeRef.current?.state["molecule.structure"]) {
      setLoading(false);
      return;
    }
    if (!window.studio) {
      setError("Open the desktop application to retrieve structures.");
      setLoading(false);
      return;
    }
    window.studio
      .invoke<StructureData>("structure:fetch", { source, id })
      .then((value) => {
        if (alive) {
          setStructure(value);
          setStructureLabel(
            caption ||
              value.name ||
              `${source === "pdb" ? "PDB" : "PubChem"} · ${id}`,
          );
          setLookup(id);
          setProvider(source);
          setShowDepiction(false);
          setComparison(null);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, source, caption]);
  useEffect(() => {
    let alive = true;
    const element = container.current;
    if (!element || !structure) return;
    loadMol()
      .then((lib) => {
        if (!alive) return;
        if (!viewer.current)
          viewer.current = lib.createViewer(element, {
            backgroundColor:
              getComputedStyle(element).getPropertyValue("--figure").trim() ||
              "#242424",
            antialias: true,
          });
        const v = viewer.current;
        v.setViewChangeCallback(null);
        v.clear();
        v.setBackgroundColor(
          getComputedStyle(element).getPropertyValue("--figure").trim() ||
            "#242424",
        );
        const models = [
          { ...structure, data: frameData ?? structure.data },
          ...(comparison ? [comparison] : []),
        ];
        for (const [i, item] of models.entries()) {
          const model = v.addModel(item.data, item.format);
          const atoms = model.selectedAtoms({});
          if (!atoms.length)
            throw new Error("The file did not contain readable atoms.");
          const polymer = atoms.some(
            (atom: any) => atom.atom === "CA" || atom.atom === "P",
          );
          if (style === "cartoon" && polymer) {
            model.setStyle(
              {},
              { cartoon: { color: i ? "#c99470" : "spectrum" } },
            );
            model.setStyle(
              { hetflag: true },
              { stick: { radius: 0.15 } },
              true,
            );
          } else
            model.setStyle(
              {},
              style === "line"
                ? { line: { colorscheme: i ? "orangeCarbon" : "default" } }
                : { stick: { radius: 0.15 }, sphere: { scale: 0.25 } },
            );
        }
        selected.current = [];
        const handleAtom = (atom: any) => {
          selected.current = [...selected.current, atom].slice(
            -(selectionMode === "torsion"
              ? 4
              : selectionMode === "angle"
                ? 3
                : 2),
          );
          setSelectedAtoms(
            selected.current.map((value) => ({
              serial: value.serial,
              model: value.model ?? 0,
            })),
          );
          const residue =
            selectionMode === "residue" && atom.resi !== undefined;
          const label = residue
            ? `Residue ${atom.resn ?? ""} ${atom.resi} · chain ${atom.chain || "—"}`
            : `${atom.resn ?? ""} ${atom.resi ?? ""} ${atom.atom ?? atom.elem ?? ""} · chain ${atom.chain || "—"}`.trim();
          setSelection(label);
          if (residue) {
            v.addStyle(
              { chain: atom.chain, resi: atom.resi },
              { stick: { radius: 0.22, colorscheme: "yellowCarbon" } },
            );
            setDistance("");
          }
          v.removeAllLabels();
          v.addLabel(label, {
            position: atom,
            fontSize: 12,
            backgroundColor:
              getComputedStyle(element).getPropertyValue("--popover").trim() ||
              "#302923",
            fontColor:
              getComputedStyle(element).getPropertyValue("--text").trim() ||
              "#ffffff",
          });
          if (!residue) {
            try {
              const atoms = selected.current,
                points = atoms.map(atomPoint);
              if (selectionMode === "atom" && points.length === 2)
                setDistance(
                  `${atomicDistance(points[0], points[1]).toFixed(3)} Å`,
                );
              if (selectionMode === "angle" && points.length === 3)
                setDistance(
                  `Angle ${atomicAngle(points[0], points[1], points[2]).toFixed(3)}°`,
                );
              if (selectionMode === "torsion" && points.length === 4)
                setDistance(
                  `Torsion ${atomicTorsion(points[0], points[1], points[2], points[3]).toFixed(3)}°`,
                );
              v.removeAllShapes();
              for (let i = 1; i < atoms.length; i++)
                v.addLine({
                  start: atoms[i - 1],
                  end: atoms[i],
                  color:
                    getComputedStyle(element)
                      .getPropertyValue("--accent")
                      .trim() || "#e8c4a6",
                  dashed: true,
                });
            } catch (error) {
              setError(errorMessage(error));
            }
          }
          v.render();
        };
        selectAtom.current = handleAtom;
        v.setClickable({}, true, handleAtom);
        for (const saved of selectedAtomsRef.current) {
          const atom = v.selectedAtoms(saved)[0];
          if (atom) handleAtom(atom);
        }
        if (surface) {
          lib.setSyncSurface?.(true);
          void v.addSurface(
            lib.SurfaceType?.VDW ?? 1,
            {
              opacity: 0.45,
              color:
                getComputedStyle(element).getPropertyValue("--accent").trim() ||
                "#89aa9c",
            },
            {},
          );
        }
        v.zoomTo();
        if (cameraRef.current) v.setView(cameraRef.current);
        v.setViewChangeCallback((view: number[]) => {
          if (Date.now() - cameraSavedAt.current < 100) return;
          cameraSavedAt.current = Date.now();
          setCamera(view);
        });
        v.resize();
        setError("");
        v.spin(
          spinning && runtimeRef.current?.visible !== false ? "y" : false,
          0.8,
        );
        v.render();
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [
    structure,
    comparison,
    style,
    surface,
    spinning,
    revision,
    selectionMode,
    frameData,
  ]);
  useEffect(() => {
    const observer = createVisualThemeObserver(() => setRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    const element = container.current;
    const resize = new ResizeObserver(() => {
      viewer.current?.resize();
      viewer.current?.render();
    });
    if (element) resize.observe(element);
    return () => {
      observer.disconnect();
      resize.disconnect();
      if (viewer.current) {
        viewer.current.spin(false);
        viewer.current.clear();
        viewer.current = null;
      }
    };
  }, []);
  return (
    <FigureFrame title={structureLabel} tag="Molecular structure">
      <form
        className="structure-search"
        onSubmit={(e) => {
          e.preventDefault();
          void fetchStructure();
        }}
      >
        <select
          aria-label="Molecular database"
          value={provider}
          onChange={(e) => setProvider(e.target.value as "pdb" | "pubchem")}
        >
          <option value="pdb">RCSB PDB</option>
          <option value="pubchem">PubChem CID</option>
        </select>
        <input
          aria-label="Structure identifier"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          maxLength={30}
        />
        <button disabled={loading}>Load</button>
      </form>
      <div className="visual-toolbar structure-tools">
        <select
          aria-label="Molecular representation"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        >
          <option value="cartoon">Cartoon + ligands</option>
          <option value="stick">Ball and stick</option>
          <option value="line">Lines</option>
        </select>
        <button aria-pressed={surface} onClick={() => setSurface((v) => !v)}>
          Surface
        </button>
        <button aria-pressed={spinning} onClick={() => setSpinning((v) => !v)}>
          {spinning ? "Stop rotation" : "Rotate"}
        </button>
        <button
          onClick={() => {
            viewer.current?.zoomTo();
            viewer.current?.render();
          }}
        >
          Fit
        </button>
      </div>
      {loading && (
        <div className="visual-status" role="status">
          Retrieving real structure coordinates…
        </div>
      )}
      {error && (
        <div className="visual-error" role="status">
          {error}
          <button onClick={() => void fetchStructure()}>Retry</button>
        </div>
      )}
      <div
        ref={container}
        className="molecule-canvas"
        aria-label="Interactive molecular viewer"
      />
      <div className="molecule-selection">
        <label>
          Select{" "}
          <select
            aria-label="Molecular selection mode"
            value={selectionMode}
            onChange={(e) => {
              setSelectionMode(
                e.target.value as "atom" | "residue" | "angle" | "torsion",
              );
              setSelection("");
              setDistance("");
            }}
          >
            <option value="atom">Atoms · measure distance</option>
            <option value="residue">Residues · highlight</option>
            <option value="angle">Angle · select 3 atoms</option>
            <option value="torsion">Torsion · select 4 atoms</option>
          </select>
        </label>
        <span>
          {selection ||
            "Drag to rotate · scroll to zoom · select two atoms to measure"}
        </span>
        {distance && <strong>Measurement: {distance}</strong>}
        <div className="visual-action-row">
          <input
            aria-label="Atom serial number"
            type="number"
            min="1"
            max="1000000"
            value={atomSerial}
            onChange={(e) => setAtomSerial(e.target.value)}
          />
          <button
            onClick={() => {
              const atom = viewer.current?.selectedAtoms({
                model: 0,
                serial: Number(atomSerial),
              })[0];
              if (atom) selectAtom.current(atom);
              else
                setError(
                  "That atom serial was not found in the loaded source structure.",
                );
            }}
          >
            Select source atom
          </button>
        </div>
      </div>
      <div className="visual-action-row">
        <button
          disabled={loading || !structure}
          onClick={() => void fetchStructure(true)}
        >
          Compare with identifier
        </button>
        <button
          disabled={loading}
          onClick={async () => {
            try {
              const data = await window.studio?.invoke<StructureData | null>(
                "structure:import",
              );
              if (data) {
                setStructure(data);
                setStructureLabel(data.name || "Imported molecular structure");
                setComparison(null);
                setShowDepiction(false);
                setError("");
              }
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Open structure file
        </button>
        {comparison && (
          <button onClick={() => setComparison(null)}>Remove comparison</button>
        )}
        {provider === "pubchem" && (
          <button
            disabled={loading}
            aria-pressed={showDepiction}
            onClick={async () => {
              if (showDepiction) {
                setShowDepiction(false);
                return;
              }
              setLoading(true);
              try {
                if (!window.studio)
                  throw new Error(
                    "Open the desktop application to retrieve chemical depictions.",
                  );
                const result = await window.studio.invoke<{
                  dataUrl: string;
                  sourceUrl: string;
                }>("structure:depiction", { id: lookup.trim() });
                setDepiction({ ...result, id: lookup.trim() });
                setShowDepiction(true);
                setError("");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            {showDepiction ? "Hide 2D diagram" : "Chemical 2D diagram"}
          </button>
        )}
      </div>
      {showDepiction && depiction && (
        <div className="chemical-depiction">
          <img
            src={depiction.dataUrl}
            alt={`PubChem chemical connectivity diagram for CID ${depiction.id}`}
          />
          <p className="visual-caption">
            PubChem CID {depiction.id} ·{" "}
            <a href={depiction.sourceUrl} target="_blank" rel="noreferrer">
              Authoritative 2D chemical depiction ↗
            </a>
            . Atomic connectivity is supplied by PubChem.
          </p>
        </div>
      )}
      <MolecularAdvancedPanel
        structure={structure}
        comparison={comparison}
        onFrame={(value) => setFrameData(value)}
        onAligned={(value) => {
          setComparison(value);
          setAligned(true);
        }}
        onSelection={(value) => {
          const v = viewer.current;
          if (!v) throw new Error("Load a molecular structure first.");
          const atoms = v.selectedAtoms(value);
          if (!atoms.length)
            throw new Error(
              "The selection matched no atoms. Check chain identifiers and residue numbering.",
            );
          v.addStyle(value, {
            stick: { radius: 0.24, colorscheme: "yellowCarbon" },
          });
          v.zoomTo(value);
          v.render();
          return atoms.length;
        }}
      />
      <ChemistryLab structure={structure} />
      <p className="visual-caption">
        {comparison
          ? aligned
            ? "Comparison coordinates are rigidly aligned; see the reported atom correspondence and RMSD. "
            : "Structures are overlaid in their original coordinate frames; use alignment tools to compare matched atoms. "
          : ""}
        {structure?.sourceUrl && (
          <a href={structure.sourceUrl} target="_blank" rel="noreferrer">
            Structure source ↗
          </a>
        )}{" "}
        Coordinates come from the source file. 3Dmol interprets standard file
        connectivity and may infer display bonds from geometry. Distances use
        ångströms.
      </p>
    </FigureFrame>
  );
}

export function ImageSearchView({
  query,
  retrievalRequested = false,
}: {
  query: string;
  retrievalRequested?: boolean;
}) {
  const [term, setTerm] = useVisualState("image.term", query);
  const [provider, setProvider] = useVisualState("image.provider", "wikimedia");
  const [storedResults, setResults] = useVisualState<ImageResult[]>(
    "image.results",
    [],
  );
  const results = useMemo(
    () =>
      Array.isArray(storedResults)
        ? storedResults.filter(
            (item) =>
              item &&
              typeof item.url === "string" &&
              /^(https:\/\/|data:image\/(?:png|jpeg|webp|svg\+xml)[;,])/i.test(
                item.url,
              ) &&
              typeof item.source === "string" &&
              item.source.startsWith("https://") &&
              typeof item.license === "string",
          )
        : [],
    [storedResults],
  );
  const [active, setActive] = useVisualState("image.active", 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useVisualState("image.zoom", 1);
  const runtime = useVisualRuntime();
  const requestSequence = useRef(0);
  async function search(value: string, selectedProvider = provider) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      if (!window.studio)
        throw new Error(
          "Image retrieval is available in the desktop application.",
        );
      const data = await window.studio.invoke<ImageResult[]>("images:search", {
        query: value,
        provider: selectedProvider,
      });
      if (sequence !== requestSequence.current) return;
      setResults(data);
      setActive(0);
      setZoom(1);
      if (!data.length)
        setError(
          "No reusable educational images were found. Try a different phrase.",
        );
    } catch (e) {
      if (sequence === requestSequence.current) setError(errorMessage(e));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (
      Array.isArray(runtime?.state["image.results"]) &&
      (runtime!.state["image.results"] as unknown[]).length
    )
      return;
    setTerm(query);
    // The portable edition's adapter reads embedded licensed assets only. It
    // must hydrate legacy images even though desktop auto-search is opt-in.
    if (retrievalRequested || window.studio?.platform === "offline-export")
      void search(query);
    return () => {
      requestSequence.current++;
    };
  }, [query, retrievalRequested]);
  const item = results[active];
  return (
    <FigureFrame
      title={`Educational images: ${query.length > 70 ? query.slice(0, 67) + "..." : query}`}
      tag="Licensed image retrieval"
      tools={
        runtime && (
          <button
            onClick={() => runtime.move("inline")}
            aria-label="Move retrieved image into lesson"
          >
            Read inline
          </button>
        )
      }
    >
      {item?.searchQuery && item.searchQuery !== query && (
        <p className="muted">
          Found using a shorter search: {item.searchQuery}
        </p>
      )}
      <form
        className="image-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(term);
        }}
      >
        <input
          aria-label="Search educational images"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          maxLength={200}
        />
        <select
          aria-label="Inline image source"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            void search(term, e.target.value);
          }}
        >
          <option value="all">All reusable sources</option>
          <option value="wikimedia">Wikimedia Commons</option>
          <option value="openverse">Openverse</option>
          <option value="pmc">Open-access article figures</option>
        </select>
        <button disabled={loading}>Search</button>
        {loading && (
          <button
            type="button"
            onClick={() => {
              requestSequence.current++;
              setLoading(false);
            }}
          >
            Stop waiting
          </button>
        )}
      </form>
      {!loading && !error && !results.length && !retrievalRequested && (
        <p className="visual-status">
          This saved search has no image yet. Select Search to look for a real
          source figure. New lesson figures are authored inline by default.
        </p>
      )}
      {loading && (
        <div className="visual-status" role="status">
          Searching{" "}
          {provider === "wikimedia"
            ? "Wikimedia Commons"
            : provider === "openverse"
              ? "Openverse"
              : provider === "pmc"
                ? "open-access scientific figures"
                : "reusable image sources"}
          …
        </div>
      )}
      {error && (
        <div className="visual-error" role="status">
          {error}
          <button onClick={() => void search(term)}>Retry</button>
        </div>
      )}
      {item && (
        <>
          {results.length > 1 && (
            <div
              className="image-result-choices"
              aria-label="Choose an educational image"
            >
              {results.slice(0, 12).map((result, i) => (
                <button
                  key={result.id}
                  type="button"
                  aria-label={`Choose image ${i + 1}: ${result.title}`}
                  aria-pressed={active === i}
                  onClick={() => {
                    setActive(i);
                    setZoom(1);
                    setError("");
                  }}
                >
                  <img
                    src={result.thumbnail || result.url}
                    alt=""
                    loading="lazy"
                  />
                  <span>{result.title}</span>
                  <small>{result.license}</small>
                </button>
              ))}
            </div>
          )}
          <div className="image-viewport">
            <img
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
              src={item.url}
              alt={item.caption || item.title}
              onError={() =>
                setError(
                  "The source image could not be loaded. Try an alternative result.",
                )
              }
              loading="lazy"
            />
          </div>
          <div className="diagram-tools">
            <button
              disabled={active === 0}
              onClick={() => {
                setActive((v) => v - 1);
                setZoom(1);
              }}
            >
              ← Previous
            </button>
            <span>
              {active + 1} of {results.length}
            </span>
            <p>
              {item.provider ? `Retrieved from ${item.provider}. ` : ""}
              {item.cached
                ? "Available from the permitted local image cache."
                : "External source. Use the source link to inspect the original context."}
            </p>
            <button
              disabled={active === results.length - 1}
              onClick={() => {
                setActive((v) => v + 1);
                setZoom(1);
              }}
            >
              Alternative →
            </button>
            <button
              aria-label="Zoom image out"
              onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
            >
              −
            </button>
            <button
              aria-label="Zoom image in"
              onClick={() => setZoom((v) => Math.min(4, v + 0.25))}
            >
              +
            </button>
          </div>
          <figcaption className="visual-caption">
            <strong>{item.title}</strong>
            <p>{item.caption}</p>
            <span>
              {item.author} ·{" "}
              <a
                href={item.licenseUrl || item.source}
                target="_blank"
                rel="noreferrer"
              >
                {item.license || "See source license"}
              </a>{" "}
              ·{" "}
              <a href={item.source} target="_blank" rel="noreferrer">
                Source ↗
              </a>
            </span>
          </figcaption>
        </>
      )}
      <p className="visual-caption">
        Review each source's attribution and license before reuse. Images are
        retrieved separately from tutoring and do not consume model usage.
      </p>
    </FigureFrame>
  );
}

export type ExerciseState = { answer: string; skipped: boolean };
function ExerciseView({
  block,
  state,
  onChange,
}: {
  block: Extract<ContentBlock, { type: "exercise" }>;
  state?: ExerciseState;
  onChange?: (value: ExerciseState) => void;
}) {
  const [answer, setAnswer] = useState(state?.answer ?? "");
  const [skipped, setSkipped] = useState(state?.skipped ?? false);
  const [showHint, setShowHint] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  useEffect(() => {
    if (state) {
      setAnswer(state.answer);
      setSkipped(state.skipped);
    }
  }, [state?.answer, state?.skipped]);
  const changeAnswer = (value: string) => {
    setAnswer(value);
    onChange?.({ answer: value, skipped });
  };
  const toggleSkip = () => {
    setSkipped(!skipped);
    onChange?.({ answer, skipped: !skipped });
  };
  return (
    <section className="exercise-block">
      <span className="visual-tag">
        Optional practice{skipped ? " · skipped" : ""}
      </span>
      <div className="exercise-question">
        <ScientificText text={block.question} />
      </div>
      <textarea
        aria-label="Your practice answer"
        placeholder="Work through your answer here…"
        value={answer}
        disabled={skipped}
        onChange={(e) => changeAnswer(e.target.value)}
        maxLength={30000}
      />
      <div className="visual-action-row">
        {block.hint && (
          <button onClick={() => setShowHint((v) => !v)}>
            {showHint ? "Hide hint" : "Show hint"}
          </button>
        )}
        {block.answer && (
          <button onClick={() => setShowAnswer((v) => !v)}>
            {showAnswer ? "Hide explanation" : "Show explanation"}
          </button>
        )}
        <button onClick={toggleSkip}>
          {skipped ? "Resume exercise" : "Skip this exercise"}
        </button>
        <span>
          You can continue without answering. Your response does not
          automatically mark mastery.
        </span>
      </div>
      {showHint && <ScientificText text={block.hint!} />}
      {showAnswer && <ScientificText text={block.answer!} />}
    </section>
  );
}
function BlockRenderer({
  block,
  onExplain,
  exerciseState,
  onExerciseChange,
  onMCQSubmit,
}: {
  block: ContentBlock;
  onExplain?: (text: string) => void;
  exerciseState?: ExerciseState;
  onExerciseChange?: (value: ExerciseState) => void;
  onMCQSubmit?: MCQSubmit;
}) {
  switch (block.type) {
    case "concept":
      return (
        <header className="teaching-concept">
          <h3>{block.title}</h3>
          {block.objective && <p>{block.objective}</p>}
          {Boolean(block.prerequisites?.length) && (
            <div className="teaching-prerequisites">
              <strong>Useful starting point:</strong>
              {block.prerequisites?.join(" · ")}
            </div>
          )}
        </header>
      );
    case "terms":
      return (
        <aside className="teaching-terms" aria-label="Terms for this concept">
          <h4>Words to know</h4>
          <dl>
            {block.items.map((item) => (
              <div key={item.term} style={{ display: "contents" }}>
                <dt tabIndex={0} title={item.definition}>
                  {item.term}
                </dt>
                <dd>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </aside>
      );
    case "illustration":
      return (
        <FigureFrame
          title={block.spec.title}
          tag={
            block.spec.template === "scene"
              ? "Relationship diagram"
              : block.spec.template === "field-explorer" ||
                  block.spec.template === "protein-aggregation"
                ? "Interactive model"
                : block.spec.template === "interaction-vertices"
                  ? "Interaction explorer"
                  : "Scientific illustration"
          }
        >
          <ScientificIllustration spec={block.spec} />
        </FigureFrame>
      );
    case "mcq":
      return (
        <MCQView
          block={block}
          state={exerciseState}
          onChange={onExerciseChange}
          onSubmit={onMCQSubmit}
        />
      );
    case "diagram":
      return <DiagramView spec={block.spec} onExplain={onExplain} />;
    case "knowledge-graph":
      return <DiagramView spec={block.spec} onExplain={onExplain} />;
    case "plot":
      return isAdvancedPlot(block.spec) ? (
        <AdvancedPlotView spec={block.spec} />
      ) : (
        <PlotView spec={block.spec} />
      );
    case "molecule":
      return <MoleculeView {...block} />;
    case "chemical":
      return <ChemicalView {...block} />;
    case "image":
      return (
        <ImageSearchView
          query={block.query}
          retrievalRequested={block.retrievalRequested}
        />
      );
    case "equation":
      return (
        <div
          className="visual-equation"
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(block.latex, {
              throwOnError: false,
              displayMode: true,
              trust: false,
              strict: "warn",
              maxExpand: 500,
              maxSize: 20,
            }),
          }}
        />
      );
    case "text":
      return <ScientificText text={block.text} />;
    case "exercise":
      return (
        <ExerciseView
          block={block}
          state={exerciseState}
          onChange={onExerciseChange}
        />
      );
  }
}
export default function VisualBlock({
  block,
  onExplain,
  exerciseState,
  onExerciseChange,
  onMCQSubmit,
  pending = false,
}: {
  block: ContentBlock;
  onExplain?: (text: string) => void;
  exerciseState?: ExerciseState;
  onExerciseChange?: (value: ExerciseState) => void;
  onMCQSubmit?: MCQSubmit;
  pending?: boolean;
}) {
  const runtime = useVisualRuntime();
  const serialized = JSON.stringify(block);
  // Persisted catalogs can return a fresh object for the same authored block.
  // Keep the validated specification stable so an SDK scene is not recreated
  // solely because its interaction checkpoint was saved and read back.
  const safe = useMemo(() => {
    const validated = validateContentBlock(JSON.parse(serialized));
    return validated ? chooseTeachingVisual(validated) : null;
  }, [serialized]);
  if (!safe)
    return (
      <div className="visual-error" role="status">
        This visual specification was incomplete. You can continue the lesson or
        request a replacement.
      </div>
    );
  return (
    <VisualBoundary
      key={JSON.stringify(safe) + ":" + String(runtime?.state.__epoch ?? 0)}
    >
      {safe.type === "mcq" || safe.type === "exercise" ? (
        <fieldset className="checkpoint-delivery" disabled={pending}>
          {pending && (
            <p role="status">
              You can answer this checkpoint when the explanation finishes.
            </p>
          )}
          <BlockRenderer
            block={safe}
            onExplain={onExplain}
            exerciseState={exerciseState}
            onExerciseChange={onExerciseChange}
            onMCQSubmit={onMCQSubmit}
          />
        </fieldset>
      ) : (
        <BlockRenderer
          block={safe}
          onExplain={onExplain}
          exerciseState={exerciseState}
          onExerciseChange={onExerciseChange}
          onMCQSubmit={onMCQSubmit}
        />
      )}
    </VisualBoundary>
  );
}

export function VisualLab({
  onExplain,
}: {
  onExplain?: (text: string) => void;
}) {
  const [tab, setTab] = useState("");
  const [kind, setKind] = useState<
    "" | "wave" | "derivative" | "gaussian" | "logistic" | "oscillator"
  >("");
  const [authored, setAuthored] = useState<{
    id: string;
    block: ContentBlock;
  } | null>(null);
  const creator = useVisualCreator(),
    Slot = useVisualSlot();
  const titles = {
    wave: "Explore a harmonic wave",
    derivative: "A derivative is a local slope",
    gaussian: "Explore a Gaussian distribution",
    logistic: "Growth with a carrying capacity",
    oscillator: "Oscillation with damping",
  };
  const diagram: DiagramSpec = {
    title: "From question to understanding",
    nodes: [
      {
        id: "question",
        label: "Ask a question",
        detail: "Begin with an idea you want to understand.",
      },
      {
        id: "model",
        label: "Build a mental model",
        detail: "Connect a new idea to an explanation and a concrete example.",
      },
      {
        id: "test",
        label: "Test the explanation",
        detail:
          "Use a counterexample or optional practice to check what the model predicts.",
      },
      {
        id: "revise",
        label: "Refine and connect",
        detail: "Revise your explanation and connect it to other ideas.",
      },
    ],
    edges: [
      { from: "question", to: "model" },
      { from: "model", to: "test", label: "predict" },
      { from: "test", to: "revise", label: "reflect" },
    ],
  };
  return (
    <div className="visual-lab">
      <div
        className="visual-lab-tabs"
        role="tablist"
        aria-label="Visual laboratory"
      >
        {[
          ["plot", "Plots"],
          ["create", "Create"],
          ["diagram", "Diagrams"],
          ["molecule", "Molecules"],
          ["image", "Images"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!tab && (
        <p className="visual-caption">
          Select a tool above. No figure is created until you choose a model or
          source.
        </p>
      )}
      {tab === "plot" && (
        <>
          <label className="lab-plot-select">
            Mathematical model
            <select
              aria-label="Mathematical model"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                setAuthored(
                  next && creator
                    ? creator({
                        type: "plot",
                        spec: { kind: next, title: titles[next] },
                      })
                    : null,
                );
              }}
            >
              <option value="">Choose a mathematical model</option>
              <option value="wave">Harmonic wave</option>
              <option value="derivative">Derivative and tangent</option>
              <option value="gaussian">Gaussian distribution</option>
              <option value="logistic">Logistic growth</option>
              <option value="oscillator">Damped oscillator</option>
            </select>
          </label>
          {kind ? (
            authored && Slot ? (
              <Slot id={authored.id} block={authored.block} />
            ) : (
              <PlotView
                spec={{
                  kind,
                  title: titles[kind],
                }}
              />
            )
          ) : (
            <p className="visual-caption">
              Choose a model to create an interactive figure.
            </p>
          )}
        </>
      )}
      {tab === "diagram" && (
        <DiagramView spec={diagram} onExplain={onExplain} />
      )}
      {tab === "create" && <CustomMathLab />}
      {tab === "molecule" && (
        <MoleculeView id="1CRN" source="pdb" caption="Crambin · PDB 1CRN" />
      )}
      {tab === "image" && (
        <ImageSearchView query="educational scientific diagram" />
      )}
    </div>
  );
}
