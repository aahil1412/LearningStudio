import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import type { IllustrationSpec } from "../../../types";
import type { ExperimentElement } from "../../../explainerTypes";
import { useVisualRuntime, useVisualState } from "../../../lib/visualState";
import {
  compileExperiment,
  experimentCurves,
  experimentDefaults,
  experimentGeometry,
  experimentValues,
  experimentLabels,
  experimentSpringPoints,
  experimentParticlePositions,
} from "../../../lib/explainers/experiment";
import SciencePopover from "../SciencePopover";
import "./experiment-lab.css";

const number = (value: number) =>
  Math.abs(value) < 0.000001 && value !== 0
    ? value.toExponential(2)
    : Number(value.toPrecision(4)).toString();
const tones: Record<NonNullable<ExperimentElement["tone"]>, string> = {
  cool: "var(--science-rna,#2563eb)",
  warm: "var(--science-amino,#dd6849)",
  violet: "var(--science-ribosome,#8759dd)",
  green: "var(--science-trna,#0d9488)",
  neutral: "var(--text)",
};
export default function ExperimentLab({ spec }: { spec: IllustrationSpec }) {
  const model = spec.experiment!;
  const compiled = useMemo(() => compileExperiment(model), [model]);
  const runtime = useVisualRuntime();
  const [restoredParameters, setParameters] = useVisualState(
    "experiment.parameters",
    () => experimentDefaults(model),
  );
  const parameters = Object.fromEntries(
    model.parameters.map((p) => {
      const value =
        restoredParameters && typeof restoredParameters === "object"
          ? restoredParameters[p.id]
          : undefined;
      return [
        p.id,
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(p.min, Math.min(p.max, value))
          : p.value,
      ];
    }),
  );
  const [restoredTime, setTime] = useVisualState("experiment.time", 0);
  const [restoredStage, setStage] = useVisualState("experiment.stage", 0);
  const [restoredSelected, setSelected] = useVisualState(
    "experiment.selected",
    "",
  );
  const [playing, setPlaying] = useState(false),
    [anchor, setAnchor] = useState<Element | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const id = useId().replace(/:/g, "");
  const duration = model.time?.duration || 0;
  const time =
    typeof restoredTime === "number" && Number.isFinite(restoredTime)
      ? Math.max(0, Math.min(duration, restoredTime))
      : 0;
  const stage =
    typeof restoredStage === "number" && Number.isFinite(restoredStage)
      ? Math.max(
          0,
          Math.min((model.stages?.length || 1) - 1, Math.floor(restoredStage)),
        )
      : 0;
  const selected = typeof restoredSelected === "string" ? restoredSelected : "";
  const activeStage =
    model.stages?.[
      Math.max(0, Math.min((model.stages?.length || 1) - 1, stage))
    ];
  useEffect(() => {
    const pauseHidden = () => {
      if (document.visibilityState === "hidden") setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => document.removeEventListener("visibilitychange", pauseHidden);
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (
      runtime?.visible === false ||
      !model.time ||
      document.visibilityState === "hidden"
    ) {
      setPlaying(false);
      return;
    }
    if (time >= duration) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setTime(Math.min(duration, time + model.time!.step)),
      80,
    );
    return () => clearTimeout(timer);
  }, [playing, time, duration, model.time, runtime?.visible, setTime]);
  const computed = useMemo(() => {
    try {
      const values = experimentValues(compiled, parameters, time);
      return {
        values,
        geometry: experimentGeometry(compiled, values),
        curves: experimentCurves(compiled, values),
        error: "",
      };
    } catch (error) {
      return {
        values: {},
        geometry: [],
        curves: [],
        error:
          error instanceof Error
            ? error.message
            : "This setting cannot be calculated.",
      };
    }
  }, [compiled, parameters, time]);
  const selectedElement = model.scene?.elements.find((e) => e.id === selected);
  const change = (key: string, value: number) => {
    setPlaying(false);
    setParameters({ ...parameters, [key]: value });
  };
  const pickStage = (index: number) => {
    const next = model.stages?.[index];
    if (!next) return;
    setPlaying(false);
    setStage(index);
    setAnchor(null);
    if (next.parameters) setParameters({ ...parameters, ...next.parameters });
    if (next.time !== undefined) setTime(next.time);
  };
  const reset = () => {
    setPlaying(false);
    setTime(0);
    setStage(0);
    setSelected("");
    setAnchor(null);
    setParameters(experimentDefaults(model));
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || !model.scene) return;
    const element = model.scene.elements.find((e) => e.id === drag),
      binding = element?.drag;
    const parameter = model.parameters.find(
      (p) => p.id === binding?.parameterId,
    );
    if (!binding || !parameter) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const position = binding.axis === "x" ? point.x : point.y;
    const fraction = Math.max(
      0,
      Math.min(1, (position - binding.from) / (binding.to - binding.from)),
    );
    const value = parameter.min + fraction * (parameter.max - parameter.min);
    change(
      parameter.id,
      Math.max(
        parameter.min,
        Math.min(
          parameter.max,
          Math.round((value - parameter.min) / parameter.step) *
            parameter.step +
            parameter.min,
        ),
      ),
    );
  };
  const ys = computed.curves.flatMap((c) =>
    c.points.flatMap((p) => (p.y === null ? [] : [p.y])),
  );
  const low = Math.min(0, ...ys),
    high = Math.max(1, ...ys);
  const xScale = scaleLinear()
    .domain(model.plot?.domain || [0, 1])
    .range([82, 748]);
  const yScale = scaleLinear()
    .domain(model.plot?.range || [low, high + (high - low) * 0.06])
    .range([250, 25]);
  const curveLine = line<{ x: number; y: number | null }>()
    .defined((p) => p.y !== null)
    .x((p) => xScale(p.x))
    .y((p) => yScale(p.y!));
  return (
    <div className="learning-experiment" data-explainer="experiment">
      <p className="experiment-question">{model.question}</p>
      {model.stages && (
        <nav
          className="experiment-stages"
          aria-label="Experiment explanation steps"
        >
          {model.stages.map((s, i) => (
            <button
              key={s.id}
              aria-pressed={i === stage}
              onClick={() => pickStage(i)}
            >
              {s.title}
            </button>
          ))}
        </nav>
      )}
      {activeStage && (
        <p className="experiment-explanation" aria-live="polite">
          {activeStage.explanation}
        </p>
      )}
      {computed.error && (
        <p role="alert" className="experiment-error">
          {computed.error} <button onClick={reset}>Reset experiment</button>
        </p>
      )}
      {model.scene && !computed.error && (
        <div className="experiment-viewport">
          <svg
            role="group"
            aria-label={`${spec.title}: interactive mechanism`}
            viewBox={`0 0 ${model.scene.width} ${model.scene.height}`}
            onPointerMove={move}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onLostPointerCapture={() => setDrag(null)}
          >
            <title>{spec.title}</title>
            <desc>
              {model.question} Select components to inspect them. Drag enabled
              objects or use the named parameter sliders.
            </desc>
            <defs>
              <clipPath id={id + "sceneClip"}>
                <rect
                  x="0"
                  y="0"
                  width={model.scene.width}
                  height={model.scene.height}
                />
              </clipPath>
              <marker
                id={id + "arrow"}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="12"
                markerHeight="12"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10Z" fill="context-stroke" />
              </marker>
            </defs>
            <g clipPath={`url(#${id}sceneClip)`}>
              {computed.geometry.map(({ element: e, geometry: g }) => {
                const color = tones[e.tone || "cool"],
                  r = g.radius ?? 14;
                const inspect = (target: Element) => {
                  setSelected(e.id);
                  setAnchor(target);
                };
                return (
                  <g
                    key={e.id}
                    className={`experiment-element ${selected === e.id || activeStage?.focusIds?.includes(e.id) ? "is-focused" : ""}`}
                    style={{ color, touchAction: e.drag ? "none" : "auto" }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${e.label}`}
                    data-experiment-element={e.id}
                    onClick={(event) => inspect(event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        inspect(event.currentTarget);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (e.drag) {
                        event.preventDefault();
                        setPlaying(false);
                        setDrag(e.id);
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }
                    }}
                  >
                    <title>{e.label}</title>
                    {e.kind === "circle" ? (
                      <circle cx={g.x} cy={g.y} r={r} />
                    ) : e.kind === "rect" ? (
                      <rect
                        x={g.x}
                        y={g.y}
                        width={Math.max(0, g.width || 1)}
                        height={Math.max(0, g.height || 0)}
                        rx="6"
                      />
                    ) : e.kind === "line" || e.kind === "arrow" ? (
                      <line
                        x1={g.x}
                        y1={g.y}
                        x2={g.x2 ?? g.x}
                        y2={g.y2 ?? g.y}
                        markerEnd={
                          e.kind === "arrow" ? `url(#${id}arrow)` : undefined
                        }
                      />
                    ) : e.kind === "spring" ? (
                      <polyline
                        points={experimentSpringPoints(g)
                          .map((p) => `${p.x},${p.y}`)
                          .join(" ")}
                        fill="none"
                      />
                    ) : e.kind === "particles" ? (
                      <>
                        {experimentParticlePositions(g).map((point, i) => (
                          <circle key={i} cx={point.x} cy={point.y} r={r} />
                        ))}
                      </>
                    ) : (
                      <text x={g.x} y={g.y}>
                        {e.text || e.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {experimentLabels(
              computed.geometry,
              model.scene.width,
              model.scene.height,
            ).map(
              (label) =>
                label && (
                  <text
                    key={label.id}
                    className="experiment-object-label"
                    x={label.x}
                    y={label.y}
                    textAnchor="middle"
                  >
                    {label.lines.map((part, i) => (
                      <tspan key={i} x={label.x} dy={i ? 24 : 0}>
                        {part}
                      </tspan>
                    ))}
                  </text>
                ),
            )}
          </svg>
        </div>
      )}
      {model.scene && (
        <div
          className="experiment-component-index"
          aria-label="Experiment components"
        >
          {model.scene.elements.map((e) => (
            <button
              key={e.id}
              aria-pressed={selected === e.id}
              onClick={(event) => {
                setSelected(e.id);
                setAnchor(event.currentTarget);
              }}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
      {selectedElement && !anchor && (
        <p className="experiment-selection">
          <strong>{selectedElement.label}.</strong>{" "}
          {selectedElement.detail ||
            "Change the linked inputs and compare this component with the calculated readouts."}
        </p>
      )}
      {model.plot && !computed.error && (
        <div className="experiment-viewport">
          <svg
            className="experiment-plot"
            role="img"
            aria-label={`${spec.title}: calculated graph`}
            viewBox="0 0 800 320"
          >
            <title>{spec.title}: calculated parameter relationships</title>
            <defs>
              <clipPath id={id + "clip"}>
                <rect x="82" y="25" width="666" height="225" />
              </clipPath>
            </defs>
            {yScale.ticks(5).map((t) => (
              <g key={t}>
                <line
                  className="experiment-grid"
                  x1="82"
                  x2="748"
                  y1={yScale(t)}
                  y2={yScale(t)}
                />
                <text x="69" y={yScale(t) + 6} textAnchor="end">
                  {number(t)}
                </text>
              </g>
            ))}
            {xScale.ticks(6).map((t) => (
              <g key={t}>
                <line
                  className="experiment-grid"
                  x1={xScale(t)}
                  x2={xScale(t)}
                  y1="25"
                  y2="250"
                />
                <text x={xScale(t)} y="276" textAnchor="middle">
                  {number(t)}
                </text>
              </g>
            ))}
            <text x="415" y="311" textAnchor="middle">
              {model.plot.xLabel}
            </text>
            <text transform="translate(22 143) rotate(-90)" textAnchor="middle">
              {model.plot.yLabel}
            </text>
            <g clipPath={`url(#${id}clip)`}>
              {computed.curves.map((c, i) => (
                <path
                  key={c.id}
                  className="experiment-curve"
                  data-curve={c.id}
                  d={curveLine(c.points) || ""}
                  style={{
                    stroke: tones[model.plot!.curves[i].tone || "cool"],
                  }}
                />
              ))}
            </g>
          </svg>
          <div className="experiment-legend">
            {model.plot.curves.map((c) => (
              <span key={c.id}>
                <i style={{ background: tones[c.tone || "cool"] }} />
                {c.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="experiment-controls">
        {model.parameters.map((p) => (
          <label key={p.id}>
            <span>
              {p.label}
              <output>
                {number(computed.values[p.id] ?? p.value)} {p.unit}
              </output>
            </span>
            <input
              type="range"
              aria-label={p.label}
              min={p.min}
              max={p.max}
              step={p.step}
              value={parameters[p.id] ?? p.value}
              onChange={(e) => change(p.id, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <dl className="experiment-readouts">
        {model.derived?.map((d) => (
          <div key={d.id}>
            <dt>{d.label}</dt>
            <dd data-derived={d.id}>
              {computed.error ? "Unavailable" : number(computed.values[d.id])}{" "}
              {d.unit}
            </dd>
          </div>
        ))}
      </dl>
      <div className="experiment-transport">
        {model.time && (
          <>
            <button
              onClick={() => {
                if (time >= duration) setTime(0);
                setPlaying((p) => !p);
              }}
              aria-pressed={playing}
            >
              {playing ? "Pause experiment" : "Play experiment"}
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setTime(Math.min(duration, time + model.time!.step));
              }}
            >
              Step experiment
            </button>
            <label>
              Time
              <input
                aria-label="Experiment time"
                type="range"
                min="0"
                max={duration}
                step={model.time.step}
                value={time}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
              />
              <output>
                {number(time)} {model.time.unit}
              </output>
            </label>
          </>
        )}
        <button onClick={reset}>Reset experiment</button>
      </div>
      <details className="experiment-method">
        <summary>Model, equations and assumptions</summary>
        {model.derived?.map((d) => (
          <p key={d.id}>
            <strong>{d.label}:</strong>{" "}
            <code>
              {d.id} = {d.expression}
            </code>
          </p>
        ))}
        {model.assumptions.map((a, i) => (
          <p key={i}>{a}</p>
        ))}
      </details>
      <SciencePopover
        anchor={anchor}
        title={selectedElement?.label || "Experiment component"}
        onClose={() => setAnchor(null)}
      >
        {selectedElement?.detail ||
          "Compare the component with the calculated values as you change the inputs."}
      </SciencePopover>
    </div>
  );
}
