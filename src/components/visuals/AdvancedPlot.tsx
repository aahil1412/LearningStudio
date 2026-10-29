import { useEffect, useMemo, useRef, useState } from "react";
import type { PlotSpec } from "../../types";
import {
  scientificCurves,
  sampleSurface,
  sampleVectorField,
} from "../../lib/science/plots";
import { expressionFunctions } from "../../lib/science/expressions";
import { validateContentBlock } from "../../lib/visualSpecs";
import {
  createVisualThemeObserver,
  useVisualCheckpoint,
  useVisualRuntime,
  useVisualState,
  useVisualCreator,
  useVisualCatalog,
  useVisualSlot,
} from "../../lib/visualState";

const advancedKinds = ["function", "parametric", "surface", "vector", "ode"];
export function isAdvancedPlot(spec: PlotSpec) {
  return advancedKinds.includes(spec.kind);
}
const fail = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "This mathematical model could not be rendered.";
function download(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

function ThreePlot({
  spec,
  parameters,
  revision,
  onError,
}: {
  spec: PlotSpec;
  parameters: Record<string, number>;
  revision: number;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useVisualRuntime(),
    runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const [savedView, setSavedView] = useVisualState<{
      position: number[];
      quaternion: number[];
      target: number[];
      zoom: number;
    } | null>("three.camera", null),
    savedViewRef = useRef(savedView);
  savedViewRef.current = savedView;
  const readView = useRef<() => unknown>(() => undefined);
  useVisualCheckpoint("three.camera", () => readView.current());
  const reset = useRef<() => void>(() => {});
  const image = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let dispose: (() => void) | undefined;
    Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(([T, { OrbitControls }]) => {
        if (!alive || !host.current) return;
        const element = host.current,
          css = getComputedStyle(element);
        const scene = new T.Scene();
        scene.background = new T.Color(
          css.getPropertyValue("--figure").trim() || "#30342b",
        );
        const camera = new T.PerspectiveCamera(
          45,
          element.clientWidth / 340,
          0.01,
          1e7,
        );
        camera.up.set(0, 0, 1);
        const renderer = new T.WebGLRenderer({
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(element.clientWidth, 340);
        element.replaceChildren(renderer.domElement);
        dispose = () => {
          renderer.dispose();
          renderer.forceContextLoss();
          element.replaceChildren();
        };
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        const group = new T.Group();
        scene.add(group);
        const accent = new T.Color(
          css.getPropertyValue("--accent").trim() || "#92b882",
        );
        const secondary = new T.Color(
          css.getPropertyValue("--accent2").trim() || "#c29d7d",
        );
        if (spec.kind === "surface") {
          const data = sampleSurface(spec, parameters);
          const geometry = new T.BufferGeometry();
          geometry.setAttribute(
            "position",
            new T.Float32BufferAttribute(data.positions, 3),
          );
          geometry.setIndex(data.indices);
          geometry.computeVertexNormals();
          const colors: number[] = [];
          const z = data.positions.filter((_, i) => i % 3 === 2),
            zMin = Math.min(...z),
            span = Math.max(1e-12, Math.max(...z) - zMin);
          for (const value of z) {
            const color = accent.clone().lerp(secondary, (value - zMin) / span);
            colors.push(color.r, color.g, color.b);
          }
          geometry.setAttribute(
            "color",
            new T.Float32BufferAttribute(colors, 3),
          );
          group.add(
            new T.Mesh(
              geometry,
              new T.MeshStandardMaterial({
                vertexColors: true,
                side: T.DoubleSide,
                roughness: 0.7,
                metalness: 0.05,
              }),
            ),
          );
          const wire = new T.WireframeGeometry(geometry);
          group.add(
            new T.LineSegments(
              wire,
              new T.LineBasicMaterial({
                color: accent,
                transparent: true,
                opacity: 0.13,
              }),
            ),
          );
        } else if (spec.kind === "vector") {
          const vectors = sampleVectorField(spec, parameters);
          const max = Math.max(...vectors.map((v) => v.magnitude));
          const range = spec.domain ?? [-3, 3],
            length = (range[1] - range[0]) / 8;
          for (const arrow of vectors) {
            const direction = new T.Vector3(...arrow.vector).normalize(),
              color = accent.clone().lerp(secondary, arrow.magnitude / max);
            group.add(
              new T.ArrowHelper(
                direction,
                new T.Vector3(...arrow.origin),
                length,
                color,
                length * 0.3,
                length * 0.14,
              ),
            );
          }
        } else {
          const curve = scientificCurves(spec, parameters).curves[0];
          const positions: number[] = [];
          for (let i = 1; i < curve.x.length; i++) {
            if (
              [
                curve.x[i - 1],
                curve.y[i - 1],
                curve.z?.[i - 1],
                curve.x[i],
                curve.y[i],
                curve.z?.[i],
              ].some(
                (v) => v === null || !Number.isFinite(v) || Math.abs(v!) > 1e6,
              )
            )
              continue;
            positions.push(
              curve.x[i - 1]!,
              curve.y[i - 1]!,
              curve.z![i - 1]!,
              curve.x[i]!,
              curve.y[i]!,
              curve.z![i]!,
            );
          }
          if (!positions.length)
            throw new Error("The parametric curve has no finite 3D points.");
          const geometry = new T.BufferGeometry();
          geometry.setAttribute(
            "position",
            new T.Float32BufferAttribute(positions, 3),
          );
          group.add(
            new T.LineSegments(
              geometry,
              new T.LineBasicMaterial({ color: accent }),
            ),
          );
        }
        const box = new T.Box3().setFromObject(group),
          center = box.getCenter(new T.Vector3()),
          size = box.getSize(new T.Vector3()),
          extent = Math.max(size.x, size.y, size.z, 0.1);
        const axes = new T.AxesHelper(extent * 0.65);
        scene.add(axes);
        scene.add(new T.HemisphereLight("#ffffff", "#3f4440", 2.2));
        const light = new T.DirectionalLight("#ffffff", 2.5);
        light.position.set(extent, extent, extent * 2);
        scene.add(light);
        const fit = () => {
          camera.position
            .copy(center)
            .add(new T.Vector3(extent * 1.4, -extent * 1.8, extent * 1.3));
          camera.far = extent * 100 + 10;
          camera.updateProjectionMatrix();
          controls.target.copy(center);
          controls.update();
          renderer.render(scene, camera);
        };
        reset.current = fit;
        fit();
        const saved = savedViewRef.current;
        if (saved?.position?.length === 3 && saved.target?.length === 3) {
          camera.position.fromArray(saved.position);
          controls.target.fromArray(saved.target);
          if (saved.quaternion?.length === 4)
            camera.quaternion.fromArray(saved.quaternion);
          camera.zoom = saved.zoom || 1;
          camera.updateProjectionMatrix();
          controls.update();
        }
        const read = () => ({
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
        });
        readView.current = read;
        let lastCheckpoint = 0;
        const checkpoint = () => {
          if (Date.now() - lastCheckpoint < 90) return;
          lastCheckpoint = Date.now();
          setSavedView(read());
        };
        controls.addEventListener("change", checkpoint);
        controls.addEventListener("end", () => setSavedView(read()));
        image.current = () =>
          download(
            renderer.domElement.toDataURL("image/png"),
            "learning-studio-3d.png",
          );
        let frame = 0;
        const animate = () => {
          if (
            element.clientWidth > 0 &&
            runtimeRef.current?.visible !== false
          ) {
            controls.update();
            renderer.render(scene, camera);
          }
          frame = requestAnimationFrame(animate);
        };
        animate();
        const observer = new ResizeObserver(() => {
          if (!host.current || host.current.clientWidth <= 0) return;
          camera.aspect = host.current.clientWidth / 340;
          camera.updateProjectionMatrix();
          renderer.setSize(host.current.clientWidth, 340);
        });
        observer.observe(element);
        dispose = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          scene.traverse((object) => {
            const mesh = object as any;
            mesh.geometry?.dispose();
            if (Array.isArray(mesh.material))
              mesh.material.forEach((material: any) => material.dispose());
            else mesh.material?.dispose();
          });
          renderer.dispose();
          renderer.forceContextLoss();
          element.replaceChildren();
        };
        onError("");
      })
      .catch((error) => {
        dispose?.();
        dispose = undefined;
        if (alive) onError(fail(error));
      });
    return () => {
      alive = false;
      dispose?.();
    };
  }, [spec, parameters, revision, onError]);
  return (
    <>
      <div
        ref={host}
        className="science-three-canvas"
        aria-label="Interactive 3D scientific plot"
      />
      <div className="science-axis-legend">
        <span>X · {spec.xLabel ?? "x (dimensionless)"}</span>
        <span>Y · {spec.yLabel ?? "y (dimensionless)"}</span>
        <span>Z · {spec.zLabel ?? "z (dimensionless)"}</span>
      </div>
      <div className="visual-action-row">
        <button onClick={() => reset.current()}>Reset camera</button>
        <button onClick={() => image.current()}>Export 3D figure</button>
        <span>
          Drag to orbit · scroll to zoom
          {spec.kind === "vector"
            ? " · arrows show direction; color encodes magnitude"
            : ""}
        </span>
      </div>
    </>
  );
}

export function AdvancedPlotView({ spec }: { spec: PlotSpec }) {
  const runtime = useVisualRuntime();
  const [parameters, setParameters] = useVisualState("advanced.parameters", {
      ...spec.parameters,
    }),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [expanded, setExpanded] = useState(false),
    [playing, setPlaying] = useVisualState("advanced.playing", false),
    [timeIndex, setTimeIndex] = useVisualState("advanced.timeIndex", 0);
  const [savedLayout, setSavedLayout] = useVisualState<Record<string, unknown>>(
      "advanced.layout",
      {},
    ),
    savedLayoutRef = useRef(savedLayout);
  savedLayoutRef.current = savedLayout;
  const initialSpec = useRef(JSON.stringify(spec)),
    restoredTime = useRef(
      !!runtime && Object.hasOwn(runtime.state, "advanced.timeIndex"),
    ),
    plotListener = useRef<((data: unknown) => void) | null>(null);
  const element = useRef<HTMLDivElement>(null),
    library = useRef<any>(null);
  const readLayout = () => {
    const layout = (element.current as any)?.layout;
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
  useVisualCheckpoint("advanced.layout", readLayout);
  const three =
    spec.kind === "surface" ||
    spec.kind === "vector" ||
    (spec.kind === "parametric" && spec.expressions?.length === 3);
  const result = useMemo(() => {
    if (three) return null;
    try {
      return scientificCurves(spec, parameters);
    } catch (error) {
      return { error: fail(error), curves: [] };
    }
  }, [spec, parameters, three]);
  useEffect(() => {
    if (spec.kind === "ode") {
      if (restoredTime.current) {
        restoredTime.current = false;
        return;
      }
      setTimeIndex(Math.max(0, (result?.curves[0]?.x.length ?? 1) - 1));
      setPlaying(false);
    }
  }, [result, spec.kind]);
  useEffect(() => {
    if (initialSpec.current === JSON.stringify(spec)) return;
    initialSpec.current = JSON.stringify(spec);
    setParameters({ ...spec.parameters });
    setTimeIndex(0);
    setPlaying(false);
  }, [spec]);
  useEffect(() => {
    const observer = createVisualThemeObserver(() => setRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (
      !playing ||
      runtime?.visible === false ||
      spec.kind !== "ode" ||
      !result?.curves[0]
    )
      return;
    const handle = setInterval(
      () =>
        setTimeIndex((i) => (i + 5 >= result.curves[0].x.length ? 0 : i + 5)),
      40,
    );
    return () => clearInterval(handle);
  }, [playing, spec.kind, result, runtime?.visible]);
  useEffect(() => {
    const node = element.current;
    if (!node || three || !result || "error" in result) return;
    let alive = true;
    import("plotly.js-basic-dist-min")
      .then(async (module) => {
        if (!alive) return;
        const plotly = module.default ?? module;
        library.current = plotly;
        const css = getComputedStyle(node),
          colors = [
            css.getPropertyValue("--accent").trim(),
            css.getPropertyValue("--accent2").trim(),
            css.getPropertyValue("--link").trim(),
            "#c18f7b",
            "#8caec9",
            "#b297c4",
          ];
        const traces = result.curves.map((curve, i) => ({
          name: curve.name,
          x: spec.kind === "ode" ? curve.x.slice(0, timeIndex + 1) : curve.x,
          y: spec.kind === "ode" ? curve.y.slice(0, timeIndex + 1) : curve.y,
          type: "scatter",
          mode: "lines",
          connectgaps: false,
          line: {
            color: colors[i % colors.length],
            width: 2.3,
            dash:
              i === result.curves.length - 1 && spec.showDerivative
                ? "dash"
                : "solid",
          },
        }));
        await plotly.react(
          node,
          traces,
          {
            height: 330,
            margin: { l: 55, r: 15, t: 20, b: 65 },
            paper_bgcolor: css.getPropertyValue("--figure").trim(),
            plot_bgcolor: css.getPropertyValue("--figure").trim(),
            font: {
              color: css.getPropertyValue("--text").trim(),
              family: css.getPropertyValue("--ui-font").trim(),
              size: 11,
            },
            xaxis: {
              ...((savedLayoutRef.current.xaxis as Record<string, unknown>) ??
                {}),
              title: {
                text:
                  spec.xLabel ??
                  (spec.kind === "ode"
                    ? "Time (model units)"
                    : "x (dimensionless)"),
              },
              gridcolor: css.getPropertyValue("--border").trim(),
            },
            yaxis: {
              ...((savedLayoutRef.current.yaxis as Record<string, unknown>) ??
                {}),
              title: { text: spec.yLabel ?? "y (model units)" },
              gridcolor: css.getPropertyValue("--border").trim(),
            },
            legend: { orientation: "h", y: -0.3 },
            uirevision: spec.kind,
            ...(typeof savedLayoutRef.current.dragmode === "string"
              ? { dragmode: savedLayoutRef.current.dragmode }
              : {}),
          },
          {
            responsive: true,
            scrollZoom: true,
            displaylogo: false,
            toImageButtonOptions: {
              format: "svg",
              filename: "learning-studio-science",
            },
          },
        );
        if (!plotListener.current && (node as any).on) {
          plotListener.current = () => {
            const layout = readLayout();
            if (layout) setSavedLayout(layout);
          };
          (node as any).on("plotly_relayout", plotListener.current);
        }
        setError("");
      })
      .catch((e) => {
        if (alive) setError(fail(e));
      });
    return () => {
      alive = false;
    };
  }, [spec, parameters, result, revision, three, timeIndex, expanded]);
  useEffect(() => {
    const node = element.current;
    const resize = new ResizeObserver(() => {
      if (node && node.clientWidth > 0) library.current?.Plots.resize(node);
    });
    if (node) resize.observe(node);
    return () => {
      resize.disconnect();
      if (plotListener.current)
        (node as any)?.removeListener?.(
          "plotly_relayout",
          plotListener.current,
        );
      if (node) library.current?.purge(node);
    };
  }, []);
  const stableError = useRef(setError).current;
  return (
    <section
      className={`visual-figure advanced-science ${expanded ? "visual-expanded" : ""}`}
      aria-label={spec.title}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
    >
      <header className="visual-figure-header">
        <div>
          <span className="visual-tag">
            {spec.kind === "ode"
              ? "Numerical simulation"
              : three
                ? "3D mathematical laboratory"
                : "Mathematical laboratory"}
          </span>
          <h4>{spec.title}</h4>
        </div>
        <div className="visual-toolbar">
          {!three && (
            <button
              aria-label="Export scientific plot"
              onClick={() => {
                if (element.current)
                  void library.current?.downloadImage(element.current, {
                    format: "svg",
                    filename: "learning-studio-science",
                  });
              }}
            >
              ↓
            </button>
          )}
          <button
            aria-label={
              expanded
                ? "Exit scientific fullscreen"
                : "Expand scientific visualization"
            }
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
      {(error || (result && "error" in result && result.error)) && (
        <div className="visual-error" role="status">
          {error || ("error" in result! && result!.error)}
          <button onClick={() => setRevision((v) => v + 1)}>
            Retry rendering
          </button>
        </div>
      )}
      {three ? (
        <ThreePlot
          spec={spec}
          parameters={parameters}
          revision={revision}
          onError={stableError}
        />
      ) : (
        <div
          className="science-plot-canvas"
          ref={element}
          aria-label="Scientific expression plot"
        />
      )}
      {result && "derivative" in result && result.derivative && (
        <div className="science-symbolic">
          <strong>Symbolic derivative</strong>
          <code>{result.derivative}</code>
          <small>
            Valid where the original expression is differentiable. Gaps
            represent undefined or nonfinite evaluations.
          </small>
        </div>
      )}
      <div className="plot-controls">
        {Object.entries(parameters).map(([name, value]) => {
          const bounds = spec.parameterRanges?.[name] ?? {
            min: Math.min(-5, value * 2),
            max: Math.max(5, value * 2),
            step: 0.05,
          };
          return (
            <label key={name}>
              <span>
                {name}
                <output>{Number(value).toPrecision(5)}</output>
              </span>
              <input
                aria-label={`Parameter ${name}`}
                type="range"
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                value={value}
                onChange={(e) => {
                  setParameters((p) => ({
                    ...p,
                    [name]: Number(e.target.value),
                  }));
                  setTimeIndex(0);
                }}
              />
            </label>
          );
        })}
      </div>
      {spec.kind === "ode" && result?.curves.length !== undefined && (
        <div className="science-playback">
          <button onClick={() => setPlaying((v) => !v)}>
            {playing ? "Pause simulation" : "Play simulation"}
          </button>
          <input
            aria-label="Simulation time"
            type="range"
            min="0"
            max={Math.max(1, (result?.curves[0]?.x.length ?? 1) - 1)}
            value={timeIndex}
            onChange={(e) => {
              setTimeIndex(Number(e.target.value));
              setPlaying(false);
            }}
          />
          <span>
            t = {Number(result?.curves[0]?.x[timeIndex] ?? 0).toFixed(3)}
          </span>
          <small>
            RK4 · Δt={spec.ode?.step} · {spec.ode?.variables.join(", ")}. Verify
            convergence for sensitive or stiff systems.
          </small>
        </div>
      )}
      <div className="visual-action-row">
        <button
          onClick={() => {
            setParameters({ ...spec.parameters });
            setTimeIndex(0);
            setPlaying(false);
            setRevision((v) => v + 1);
          }}
        >
          Reset model
        </button>
        <span>Validated arithmetic AST · no executable model code</span>
      </div>
    </section>
  );
}

const examples: Record<
  string,
  {
    expressions: string;
    parameters: string;
    domain: string;
    variables?: string;
    initial?: string;
  }
> = {
  function: {
    expressions: "a*sin(x)\nx^2/10",
    parameters: '{"a":1}',
    domain: "-6.28,6.28",
  },
  parametric: {
    expressions: "cos(t)\nsin(t)\nt/5",
    parameters: "{}",
    domain: "0,12.56",
  },
  surface: { expressions: "sin(x)*cos(y)", parameters: "{}", domain: "-4,4" },
  vector: { expressions: "-y\nx\n0.2*z", parameters: "{}", domain: "-3,3" },
  ode: {
    expressions: "v\n-k*x-c*v",
    parameters: '{"k":1,"c":0.1}',
    domain: "0,20",
    variables: "x,v",
    initial: "1,0",
  },
};
export function CustomMathLab() {
  const creator = useVisualCreator(),
    catalog = useVisualCatalog(),
    Slot = useVisualSlot();
  const [authoredId, setAuthoredId] = useState<string | undefined>(
    () =>
      catalog?.instances
        .filter((instance) => instance.tags.includes("laboratory"))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id,
  );
  const authored = catalog?.instances.find(
    (instance) => instance.id === authoredId,
  );
  const [kind, setKind] = useState("function"),
    [expressions, setExpressions] = useState(examples.function.expressions),
    [parameters, setParameters] = useState(examples.function.parameters),
    [domain, setDomain] = useState(examples.function.domain),
    [variables, setVariables] = useState("x,v"),
    [initial, setInitial] = useState("1,0"),
    [step, setStep] = useState("0.02"),
    [derivative, setDerivative] = useState(true),
    [error, setError] = useState(""),
    [spec, setSpec] = useState<PlotSpec>({
      kind: "function",
      title: "Your mathematical model",
      expressions: ["a*sin(x)", "x^2/10"],
      domain: [-6.28, 6.28],
      parameters: { a: 1 },
      showDerivative: true,
    });
  const choose = (value: string) => {
    setKind(value);
    setExpressions(examples[value].expressions);
    setParameters(examples[value].parameters);
    setDomain(examples[value].domain);
    setVariables(examples[value].variables ?? "x,v");
    setInitial(examples[value].initial ?? "1,0");
    setError("");
  };
  function apply() {
    try {
      const range = domain.split(",").map(Number);
      if (range.length !== 2) throw new Error("Enter domain minimum,maximum.");
      if (kind === "ode" && range[0] !== 0)
        throw new Error(
          "ODE time starts at the initial state t=0. Enter 0,duration, or include an explicit time-origin parameter in your equations.",
        );
      const parameterValues: unknown = JSON.parse(parameters);
      if (
        !parameterValues ||
        typeof parameterValues !== "object" ||
        Array.isArray(parameterValues)
      )
        throw new Error("Parameters must be a JSON object of numbers.");
      const model = {
        kind,
        title: "Your mathematical model",
        parameters: parameterValues,
        domain: range,
        expressions: expressions
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        showDerivative: kind === "function" && derivative,
        ...(kind === "ode"
          ? {
              ode: {
                variables: variables.split(",").map((v) => v.trim()),
                derivatives: expressions
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
                initial: initial.split(",").map(Number),
                duration: range[1] - range[0],
                step: Number(step),
              },
            }
          : {}),
      };
      const block = validateContentBlock({ type: "plot", spec: model });
      if (!block || block.type !== "plot")
        throw new Error(
          "Invalid mathematical model. Check expression syntax, variable names, finite parameters and integration bounds.",
        );
      setSpec(block.spec);
      if (creator)
        setAuthoredId(
          creator(block, {
            placement: "side",
            tags: ["authored", "laboratory"],
          }).id,
        );
      setError("");
    } catch (e) {
      setError(fail(e));
    }
  }
  return (
    <div className="custom-science">
      <div className="science-intro">
        <span className="eyebrow">BUILD AN EXPLANATION YOU CAN TEST</span>
        <p>
          Write arithmetic expressions, set parameters, and explore their
          consequences. Models can supply the same validated specifications.
        </p>
      </div>
      <label>
        Representation
        <select
          aria-label="Custom scientific representation"
          value={kind}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="function">Functions and symbolic derivatives</option>
          <option value="parametric">2D / 3D parametric curve</option>
          <option value="surface">3D surface z = f(x,y)</option>
          <option value="vector">3D vector field</option>
          <option value="ode">ODE simulation</option>
        </select>
      </label>
      <label>
        {kind === "ode"
          ? "Derivative of each state variable, one per line"
          : "Expressions, one per line"}
        <textarea
          aria-label="Scientific expressions"
          value={expressions}
          maxLength={2048}
          onChange={(e) => setExpressions(e.target.value)}
        />
      </label>
      {kind === "ode" && (
        <>
          <label>
            State variables
            <input
              aria-label="ODE variables"
              value={variables}
              onChange={(e) => setVariables(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Initial state
            <input
              aria-label="ODE initial state"
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Integration step
            <input
              aria-label="ODE integration step"
              type="number"
              min="0.0001"
              step="0.01"
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </label>
        </>
      )}
      <label>
        {kind === "ode" ? "Time from 0,duration" : "Domain minimum,maximum"}
        <input
          aria-label="Scientific domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          maxLength={80}
        />
      </label>
      <label>
        Parameters (JSON numbers)
        <input
          aria-label="Scientific parameters"
          value={parameters}
          onChange={(e) => setParameters(e.target.value)}
          maxLength={1200}
        />
      </label>
      {kind === "function" && (
        <label className="science-check">
          <input
            aria-label="Show symbolic derivative"
            type="checkbox"
            checked={derivative}
            onChange={(e) => setDerivative(e.target.checked)}
          />
          Show the symbolic derivative of the first curve
        </label>
      )}
      <details>
        <summary>Expression language</summary>
        <p>
          Use + − * / ^ and parentheses. Coordinates: x; parametric t; surface
          x,y; vector x,y,z. Constants: pi,e. Functions:{" "}
          {expressionFunctions.join(", ")}. Variable names are case sensitive.
          No statements, imports, assignments, property access or JavaScript.
        </p>
      </details>
      {error && (
        <p className="visual-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" onClick={apply}>
        Apply mathematical model
      </button>
      {creator && Slot ? (
        authored ? (
          <Slot id={authored.id} block={authored.block} />
        ) : (
          <p className="visual-caption">
            Apply a model to create a persistent visual. Its parameters, camera
            and placement will stay with your subject.
          </p>
        )
      ) : (
        <AdvancedPlotView spec={spec} />
      )}
    </div>
  );
}
