import {
  useEffect,
  useState,
  type PointerEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { IllustrationSpec } from "../../types";
import { useVisualRuntime, useVisualState } from "../../lib/visualState";
import {
  aggregationKinetics,
  fieldValue,
  type FieldParameters,
} from "../../lib/scientificModels";
import SciencePopover from "./SciencePopover";
import "./scientific-models.css";
function finite(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
function useClock(key: string, initial = 0, maximum = 6) {
  const runtime = useVisualRuntime();
  const [time, setTime] = useVisualState(key + ".time", initial),
    [playing, setPlaying] = useVisualState(key + ".playing", false);
  const safe = finite(time, 0, maximum, initial);
  useEffect(() => {
    if (!playing || runtime?.visible === false) return;
    if (safe >= maximum) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setTime(Math.min(maximum, safe + 0.08)), 80);
    return () => clearTimeout(timer);
  }, [playing, safe, maximum, runtime?.visible, setTime, setPlaying]);
  return { time: safe, setTime, playing, setPlaying, maximum };
}
function Slider({
  label,
  value,
  set,
  min,
  max,
  step = 0.1,
  unit = "",
  name,
}: {
  label: string;
  value: number;
  set: Dispatch<SetStateAction<number>>;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  name?: string;
}) {
  return (
    <label className="model-parameter">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {unit ? " " + unit : ""}
        </output>
      </span>
      <input
        type="range"
        aria-label={name || label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => set(Number(event.target.value))}
      />
    </label>
  );
}
function Transport({
  clock,
  reset,
}: {
  clock: ReturnType<typeof useClock>;
  reset: () => void;
}) {
  return (
    <div className="model-transport">
      <button
        className="model-play"
        aria-pressed={clock.playing}
        onClick={() => {
          if (!clock.playing && clock.time >= clock.maximum) clock.setTime(0);
          clock.setPlaying(!clock.playing);
        }}
      >
        {clock.playing ? "Pause" : "Play model"}
      </button>
      <label>
        Model time
        <input
          aria-label="Model time"
          type="range"
          min="0"
          max={clock.maximum}
          step="0.08"
          value={clock.time}
          onChange={(event) => {
            clock.setPlaying(false);
            clock.setTime(Number(event.target.value));
          }}
        />
      </label>
      <output>{clock.time.toFixed(1)} relative time units</output>
      <button onClick={reset}>Reset model</button>
    </div>
  );
}
export function FieldExplorer({ spec }: { spec: IllustrationSpec }) {
  const [amplitude, setAmplitude] = useVisualState(
      "field.amplitude",
      spec.field?.amplitude ?? 1,
    ),
    [wavelength, setWavelength] = useVisualState(
      "field.wavelength",
      spec.field?.wavelength ?? 2.4,
    ),
    [width, setWidth] = useVisualState("field.width", spec.field?.width ?? 1.2),
    [speed, setSpeed] = useVisualState("field.speed", spec.field?.speed ?? 1),
    [mode, setMode] = useVisualState<"wave" | "packet">(
      "field.mode",
      spec.field?.mode ?? "packet",
    ),
    [selectedX, setSelectedX] = useVisualState("field.selectedX", 0);
  const clock = useClock("field", 3, 6),
    [anchor, setAnchor] = useState<Element | null>(null);
  const p: FieldParameters = {
    amplitude: finite(amplitude, 0, 2, 1),
    wavelength: finite(wavelength, 0.5, 6, 2.4),
    width: finite(width, 0.4, 4, 1.2),
    speed: finite(speed, 0.1, 2, 1),
    mode: mode === "wave" ? "wave" : "packet",
  };
  const x = finite(selectedX, -6, 6, 0),
    value = fieldValue(x, clock.time, p);
  const samples = Array.from({ length: 241 }, (_, index) => {
    const position = -6 + index / 20;
    return {
      x: 80 + ((position + 6) * 760) / 12,
      y: 212 - 72 * fieldValue(position, clock.time, p),
    };
  });
  const line = samples
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
  const selectedPosition = 80 + ((x + 6) * 760) / 12;
  function select(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectedX(
      Math.max(
        -6,
        Math.min(
          6,
          ((((event.clientX - rect.left) * 900) / rect.width - 80) * 12) / 760 -
            6,
        ),
      ),
    );
    setAnchor(event.currentTarget);
  }
  return (
    <div className="scientific-model field-explorer" data-field-mode={p.mode}>
      <div className="model-orientation">
        <span className="model-live-dot" /> Change a parameter and watch the
        field respond. Click the curve to inspect a position.
      </div>
      <div className="model-mode-switch" aria-label="Field representation">
        <button
          aria-pressed={p.mode === "packet"}
          onClick={() => setMode("packet")}
        >
          Localized packet
        </button>
        <button
          aria-pressed={p.mode === "wave"}
          onClick={() => setMode("wave")}
        >
          Continuous wave
        </button>
      </div>
      <div className="science-viewport">
        <svg
          className="scientific-svg model-svg"
          viewBox="0 0 900 450"
          role="img"
          aria-label="Calculated classical scalar field across one spatial dimension"
          onPointerDown={select}
          onPointerMove={(event) => {
            if (event.buttons === 1) select(event);
          }}
        >
          <title>Amplitude at every position in space</title>
          <desc>
            A calculated scalar wave or Gaussian-enveloped packet, translating
            with constant speed. Drag across the curve to inspect numerical
            values.
          </desc>
          <g className="model-grid">
            {[-2, -1, 0, 1, 2].map((v) => (
              <line
                key={v}
                x1="80"
                x2="840"
                y1={212 - v * 72}
                y2={212 - v * 72}
              />
            ))}
            {[-6, -4, -2, 0, 2, 4, 6].map((v) => (
              <line
                key={v}
                x1={80 + ((v + 6) * 760) / 12}
                x2={80 + ((v + 6) * 760) / 12}
                y1="64"
                y2="360"
              />
            ))}
          </g>
          <path d={`${line}L840 212H80Z`} className="field-area" />
          <path
            d={line}
            className="field-line"
            data-field-values={samples
              .filter((_, i) => i % 40 === 0)
              .map((point) => point.y.toFixed(2))
              .join(",")}
          />
          <line x1="80" x2="840" y1="212" y2="212" className="model-axis" />
          <g className="model-axis-label">
            {[-2, 0, 2].map((v) => (
              <text key={v} x="59" y={219 - v * 72} textAnchor="end">
                {v}
              </text>
            ))}
            {[-6, -4, -2, 0, 2, 4, 6].map((v) => (
              <text
                key={v}
                x={80 + ((v + 6) * 760) / 12}
                y="389"
                textAnchor="middle"
              >
                {v}
              </text>
            ))}
            <text x="460" y="34" textAnchor="middle">
              Field amplitude, φ(x,t) [relative units]
            </text>
          </g>
          <line
            x1={selectedPosition}
            x2={selectedPosition}
            y1="64"
            y2="360"
            className="field-probe-line"
          />
          <circle
            cx={selectedPosition}
            cy={212 - value * 72}
            r="8"
            className="field-probe"
          />
          <text
            x="460"
            y="429"
            textAnchor="middle"
            className="field-position-label"
          >
            Position x [relative length units]
          </text>
        </svg>
      </div>
      <div className="model-readout" role="status">
        <strong>At x={x.toFixed(2)}</strong>
        <span>φ={value.toFixed(3)}</span>
        <span>Position is measured in relative length units.</span>
      </div>
      <div className="model-parameters">
        <Slider
          label="Amplitude"
          name="Field amplitude"
          value={p.amplitude}
          set={setAmplitude}
          min={0}
          max={2}
        />
        <Slider
          label="Wavelength"
          value={p.wavelength}
          set={setWavelength}
          min={0.5}
          max={6}
          unit="length units"
        />
        <Slider
          label="Envelope width"
          value={p.width}
          set={setWidth}
          min={0.4}
          max={4}
          unit="length units"
        />
        <Slider
          label="Propagation speed"
          value={p.speed}
          set={setSpeed}
          min={0.1}
          max={2}
          unit="length/time"
        />
      </div>
      <Transport
        clock={clock}
        reset={() => {
          clock.setPlaying(false);
          clock.setTime(3);
          setAmplitude(spec.field?.amplitude ?? 1);
          setWavelength(spec.field?.wavelength ?? 2.4);
          setWidth(spec.field?.width ?? 1.2);
          setSpeed(spec.field?.speed ?? 1);
          setSelectedX(0);
        }}
      />
      <details className="model-assumptions">
        <summary>What this model represents</summary>
        <p>
          This is a real calculation of a classical scalar field:{" "}
          {p.mode === "packet"
            ? "φ=A exp(−(x−vt)²/(2w²)) cos(2π(x−vt)/λ)"
            : "φ=A cos(2π(x−vt)/λ)"}
          , with the display time origin shifted by 3. The packet translates
          without dispersion. The finite window can crop its tails.
        </p>
        <p>
          It is an analogy for a field taking values throughout space, not a
          quantum vacuum, an electron wavefunction, or a prediction of particle
          number. Negative values are field amplitudes, not negative
          probabilities.
        </p>
      </details>
      <SciencePopover
        anchor={anchor}
        title="Inspect the field"
        onClose={() => setAnchor(null)}
      >
        <p>
          At position x={x.toFixed(2)}, the calculated field amplitude is{" "}
          {value.toFixed(3)} at model time {clock.time.toFixed(2)}.
        </p>
        <p>
          Drag across the curve, change a parameter, or play the model to
          compare values.
        </p>
      </SciencePopover>
    </div>
  );
}
function Chain({ unfolded, index = 0 }: { unfolded: boolean; index?: number }) {
  const points = Array.from({ length: 25 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return unfolded
      ? `${-24 + i * 2},${Math.sin(i * 0.83 + index) * 8}`
      : `${Math.cos(t) * (13 + 4 * Math.sin(3 * t + index))},${Math.sin(t) * (13 + 3 * Math.cos(4 * t))}`;
  }).join(" ");
  return (
    <g className={unfolded ? "chain-unfolded" : "chain-folded"}>
      <polyline points={points} />
      {unfolded && (
        <>
          <circle cx="-9" cy={Math.sin(7.5 * 0.83 + index) * 8} r="4" />
          <circle cx="13" cy={Math.sin(18.5 * 0.83 + index) * 8} r="4" />
        </>
      )}
    </g>
  );
}
export function ProteinAggregation({ spec }: { spec: IllustrationSpec }) {
  const [concentration, setConcentration] = useVisualState(
      "aggregation.concentration",
      spec.aggregation?.concentration ?? 1,
    ),
    [unfoldedFraction, setUnfolded] = useVisualState(
      "aggregation.unfoldedFraction",
      spec.aggregation?.unfoldedFraction ?? 0.45,
    ),
    [attraction, setAttraction] = useVisualState(
      "aggregation.attraction",
      spec.aggregation?.attraction ?? 0.3,
    ),
    [partition, setPartition] = useVisualState(
      "aggregation.partition",
      spec.aggregation?.partition ?? 4,
    ),
    [condensate, setCondensate] = useVisualState(
      "aggregation.condensate",
      spec.aggregation?.condensate ?? false,
    ),
    [selected, setSelected] = useVisualState("aggregation.selected", -1);
  const clock = useClock("aggregation", 0, 12),
    [anchor, setAnchor] = useState<Element | null>(null);
  const p = {
      concentration: finite(concentration, 0.2, 5, 1),
      unfoldedFraction: finite(unfoldedFraction, 0, 1, 0.45),
      attraction: finite(attraction, 0, 2, 0.3),
      partition: finite(partition, 1, 12, 4),
      condensate: Boolean(condensate),
    },
    model = aggregationKinetics(p, clock.time);
  const count = 32,
    aggregated = Math.round(count * model.aggregatedFraction),
    insideCount = p.condensate
      ? Math.round((count - aggregated) * model.insideFraction)
      : 0;
  const freeOrder = Array.from(
    { length: count - aggregated },
    (_, i) => i + aggregated,
  ).sort((a, b) => Math.sin(a * 21.721) - Math.sin(b * 21.721));
  const exposed = new Set(
    freeOrder.slice(
      0,
      Math.max(0, Math.round(count * p.unfoldedFraction) - aggregated),
    ),
  );
  const particles = Array.from({ length: count }, (_, i) => {
    const clustered = i < aggregated,
      inside = clustered
        ? p.condensate &&
          i < Math.round(aggregated * model.aggregateInsideFraction)
        : p.condensate && i - aggregated < insideCount;
    const offset = clustered ? i : i - aggregated,
      groupCount = inside
        ? insideCount
        : Math.max(1, count - aggregated - insideCount);
    const angle = i * 2.399963,
      jitter = clock.time * 0.55;
    let x: number, y: number;
    if (clustered) {
      const center = inside ? 625 : 220;
      const radius = 13 * Math.sqrt(offset + 1);
      x = center + Math.cos(angle) * radius;
      y = 205 + Math.sin(angle) * radius;
    } else if (inside) {
      const radius =
        30 +
        Math.sqrt(
          (offset % Math.max(1, groupCount)) / Math.max(1, groupCount),
        ) *
          95;
      x = 625 + Math.cos(angle + jitter) * radius;
      y = 205 + Math.sin(angle + jitter) * radius * 0.8;
    } else {
      const col = offset % 7,
        row = Math.floor(offset / 7);
      x = 80 + col * (p.condensate ? 50 : 116) + Math.sin(jitter + i) * 7;
      y = 78 + row * 55 + Math.cos(jitter + i * 1.7) * 5;
    }
    const unfolded = clustered || exposed.has(i);
    return { i, x, y, clustered, inside, unfolded };
  });
  const chosen = particles.find((item) => item.i === selected);
  return (
    <div
      className="scientific-model aggregation-explorer"
      data-aggregated-count={aggregated}
    >
      <div className="model-orientation">
        <span className="model-live-dot" /> Compare compact chains, exposed
        chains and multi-chain clusters. Adjust concentration and exposure to
        compare association.
      </div>
      <div className="model-mode-switch">
        <button
          aria-pressed={!p.condensate}
          onClick={() => setCondensate(false)}
        >
          One solution
        </button>
        <button aria-pressed={p.condensate} onClick={() => setCondensate(true)}>
          Add a condensate
        </button>
      </div>
      <div className="science-viewport">
        <svg
          className="scientific-svg model-svg aggregation-svg"
          viewBox="0 0 900 400"
          role="group"
          aria-label="Illustrative protein association model showing distinct chain conformations and clusters"
        >
          <title>Exposed chains associate over model time</title>
          <desc>
            Parameters determine a second-order illustrative association
            calculation. Chain icons and model positions are schematic, not
            molecular coordinates or a simulation of physical Brownian
            trajectories.
          </desc>
          {p.condensate && (
            <g className="condensate-region">
              <ellipse cx="625" cy="205" rx="173" ry="148" />
              <text x="625" y="38" textAnchor="middle">
                Protein-rich condensate
              </text>
              <text x="230" y="38" textAnchor="middle">
                Surrounding solution
              </text>
            </g>
          )}
          {particles.map((item) => (
            <g
              key={item.i}
              role="button"
              tabIndex={0}
              aria-label={`Inspect protein ${item.i + 1}`}
              aria-pressed={selected === item.i}
              data-chain-state={
                item.clustered
                  ? "aggregated"
                  : item.unfolded
                    ? "exposed"
                    : "folded"
              }
              transform={`translate(${item.x} ${item.y})`}
              className={`model-chain ${item.clustered ? "is-aggregated" : ""} ${selected === item.i ? "is-selected" : ""}`}
              onClick={(event) => {
                setSelected(item.i);
                setAnchor(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(item.i);
                  setAnchor(event.currentTarget);
                }
              }}
            >
              <circle r="29" className="chain-hit-target" />
              <Chain unfolded={item.unfolded} index={item.i} />
            </g>
          ))}
          <g className="aggregation-legend">
            <g transform="translate(95 367)">
              <Chain unfolded={false} />
              <text x="28" y="7">
                Compact chain
              </text>
            </g>
            <g transform="translate(355 367)">
              <Chain unfolded={true} />
              <text x="40" y="7">
                Exposed patches
              </text>
            </g>
            <g transform="translate(650 367)">
              <circle cx="0" cy="-2" r="7" />
              <circle cx="9" cy="5" r="7" />
              <text x="30" y="7">
                Associated chains
              </text>
            </g>
          </g>
        </svg>
      </div>
      <div className="model-readout" role="status">
        <strong>
          {(model.aggregatedFraction * 100).toFixed(1)}% associated
        </strong>
        <span>Free concentration: {model.free.toFixed(2)} relative units</span>
        {p.condensate && (
          <span>
            Inside {model.concentrationInside.toFixed(2)} · Outside{" "}
            {model.concentrationOutside.toFixed(2)}
          </span>
        )}
      </div>
      <div className="model-parameters">
        <Slider
          label="Initial concentration"
          value={p.concentration}
          set={setConcentration}
          min={0.2}
          max={5}
          unit="relative units"
        />
        <Slider
          label="Fraction with exposed patches"
          value={p.unfoldedFraction}
          set={setUnfolded}
          min={0}
          max={1}
          step={0.05}
        />
        <Slider
          label="Association rate"
          value={p.attraction}
          set={setAttraction}
          min={0}
          max={2}
          step={0.05}
          unit="relative units"
        />
        {p.condensate && (
          <Slider
            label="Partition ratio, inside / outside"
            value={p.partition}
            set={setPartition}
            min={1}
            max={12}
            step={0.5}
          />
        )}
      </div>
      <Transport
        clock={clock}
        reset={() => {
          clock.setPlaying(false);
          clock.setTime(0);
          setSelected(-1);
        }}
      />
      <details className="model-assumptions">
        <summary>Model assumptions and calculation</summary>
        <p>
          Exposed free-chain concentration follows C(t)=C₀/(1+kₑC₀t). Folded
          chains are not consumed in this simplified model. Concentration and
          rate are relative, illustrative parameters, not measured
          protein-specific kinetics. The colored chain paths depict
          conformations, not atomic connectivity.
        </p>
        <p>
          {p.condensate
            ? "A well-mixed condensate occupies 25% of the modeled volume. Fast exchange keeps an equilibrium partition ratio K. The effective association factor is [(1−v)+K²v]/[(1−v)+Kv]², so the total concentration is conserved while the local encounter rate changes."
            : "The solution is assumed uniform. A larger exposed fraction or association rate produces more associated material over the same model time."}{" "}
          Aggregation is treated as irreversible here; reversibility, nucleation
          barriers, chaperones and sequence-specific chemistry are omitted.
          Particle counts are rounded visual samples of the calculated
          fractions; their motion is schematic.
        </p>
      </details>
      <SciencePopover
        anchor={anchor}
        title={
          chosen?.clustered
            ? "Associated protein chain"
            : chosen?.unfolded
              ? "Exposed protein chain"
              : "Compact protein chain"
        }
        onClose={() => setAnchor(null)}
      >
        <p>
          {chosen?.clustered
            ? "This chain belongs to the associated fraction calculated by the kinetic model. The cluster contains multiple separate chains."
            : chosen?.unfolded
              ? "The extended chain exposes interaction patches (orange points). Only this susceptible pool can associate in this illustrative model."
              : "This compact chain is outside the susceptible pool in the current model. Real proteins can fold, unfold or aggregate by several mechanisms."}
        </p>
        <p>
          {chosen?.inside
            ? "It is inside the modeled condensate."
            : "It is in the surrounding solution."}{" "}
          Adjust concentration, exposed fraction or time to compare outcomes.
        </p>
      </SciencePopover>
    </div>
  );
}
