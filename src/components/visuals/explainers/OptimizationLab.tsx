import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { contours } from "d3-contour";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import type { IllustrationSpec } from "../../../types";
import {
  createVisualThemeObserver,
  useVisualCheckpoint,
  useVisualRuntime,
  useVisualState,
} from "../../../lib/visualState";
import {
  descentTrace,
  inLandscapeView,
  isLandscape,
  landscapeGradient,
  landscapeLoss,
  landscapes,
  sampleLandscape,
  type DescentPoint,
  type Landscape,
  type Point2,
} from "../../../lib/explainers/optimization";
import "./optimization-lab.css";

const WIDTH = 800,
  HEIGHT = 460;
const PLOT = { left: 72, top: 28, width: 672, height: 346 };
type CameraView = { position: number[]; target: number[]; zoom: number };
const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
function number(value: number) {
  return Math.abs(value) < 1e-4 && value !== 0
    ? value.toExponential(2)
    : Number(value.toFixed(4)).toString();
}

function Landscape3D({
  kind,
  points,
  current,
}: {
  kind: Landscape;
  points: DescentPoint[];
  current: DescentPoint;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useVisualRuntime(),
    runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const [saved, setSaved] = useVisualState<CameraView | null>(
    "optimization.camera",
    null,
  );
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const live = useRef({ points, current });
  live.current = { points, current };
  const read = useRef<() => CameraView | null>(() => savedRef.current);
  const update = useRef<() => void>(() => {});
  const zoom = useRef<(amount: number) => void>(() => {});
  const rotate = useRef<(angle: number) => void>(() => {});
  const reset = useRef<() => void>(() => {});
  const [error, setError] = useState("");
  useVisualCheckpoint("optimization.camera", () => read.current());
  useEffect(() => {
    update.current();
  }, [points, current, runtime?.visible]);
  useEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];
    const dispose = () => {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      update.current = () => {};
      zoom.current = () => {};
      rotate.current = () => {};
      reset.current = () => {};
      read.current = () => savedRef.current;
    };
    void Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(([T, { OrbitControls }]) => {
        if (!alive || !host.current) return;
        const element = host.current,
          meta = landscapes[kind],
          sample = sampleLandscape(kind, 54);
        const scene = new T.Scene(),
          camera = new T.PerspectiveCamera(43, 1, 0.01, 250);
        camera.up.set(0, 0, 1);
        const renderer = new T.WebGLRenderer({ antialias: true });
        cleanups.push(() => {
          renderer.dispose();
          renderer.forceContextLoss();
          element.replaceChildren();
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        element.replaceChildren(renderer.domElement);
        const controls = new OrbitControls(camera, renderer.domElement);
        cleanups.push(() => controls.dispose());
        // Wheel remains lesson scrolling; zoom is an explicit accessible action.
        controls.enableZoom = false;
        controls.enableDamping = false;
        controls.minPolarAngle = 0.1;
        controls.maxPolarAngle = Math.PI * 0.49;
        const world = (x: number, y: number) =>
          new T.Vector3(
            x,
            y,
            (Math.log1p(Math.max(0, landscapeLoss(kind, [x, y]))) /
              Math.log1p(sample.max)) *
              5,
          );
        const positions: number[] = [],
          colors: number[] = [],
          indices: number[] = [];
        for (let row = 0; row < sample.count; row++)
          for (let col = 0; col < sample.count; col++) {
            const x =
              meta.xDomain[0] +
              (col / (sample.count - 1)) * (meta.xDomain[1] - meta.xDomain[0]);
            const y =
              meta.yDomain[1] -
              (row / (sample.count - 1)) * (meta.yDomain[1] - meta.yDomain[0]);
            positions.push(...world(x, y).toArray());
            if (row < sample.count - 1 && col < sample.count - 1) {
              const a = row * sample.count + col,
                b = a + 1,
                c = a + sample.count,
                d = c + 1;
              indices.push(a, c, b, b, c, d);
            }
          }
        const geometry = new T.BufferGeometry();
        cleanups.push(() => geometry.dispose());
        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(positions, 3),
        );
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const material = new T.MeshStandardMaterial({
          vertexColors: true,
          side: T.DoubleSide,
          roughness: 0.85,
          metalness: 0,
        });
        cleanups.push(() => material.dispose());
        scene.add(new T.Mesh(geometry, material));
        const pathGeometry = new T.BufferGeometry(),
          pathMaterial = new T.LineBasicMaterial({
            color: "#e0703b",
            depthTest: false,
          });
        cleanups.push(() => {
          pathGeometry.dispose();
          pathMaterial.dispose();
        });
        // Fixed capacity avoids rebuilding GPU resources on every calculated update.
        const pathAttribute = new T.BufferAttribute(
          new Float32Array(300 * 2 * 3),
          3,
        );
        pathAttribute.setUsage(T.DynamicDrawUsage);
        pathGeometry.setAttribute("position", pathAttribute);
        pathGeometry.setDrawRange(0, 0);
        const trajectory = new T.LineSegments(pathGeometry, pathMaterial);
        trajectory.renderOrder = 2;
        trajectory.frustumCulled = false;
        scene.add(trajectory);
        const markerMaterial = new T.MeshBasicMaterial({
          color: "#e0703b",
          depthTest: false,
        });
        const markerGeometry = new T.SphereGeometry(0.13, 16, 12),
          marker = new T.Mesh(markerGeometry, markerMaterial);
        cleanups.push(() => {
          markerGeometry.dispose();
          markerMaterial.dispose();
        });
        marker.renderOrder = 3;
        scene.add(marker);
        const grid = new T.GridHelper(10, 10);
        cleanups.push(() => {
          grid.geometry.dispose();
          (Array.isArray(grid.material)
            ? grid.material
            : [grid.material]
          ).forEach((m) => m.dispose());
        });
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.035;
        scene.add(grid);
        scene.add(new T.HemisphereLight("#ffffff", "#243147", 2));
        const light = new T.DirectionalLight("#ffffff", 2.2);
        light.position.set(-4, -5, 12);
        scene.add(light);
        let frame = 0;
        cleanups.push(() => cancelAnimationFrame(frame));
        const requestPaint = () => {
          if (
            frame ||
            !alive ||
            runtimeRef.current?.visible === false ||
            document.visibilityState === "hidden" ||
            element.clientWidth <= 0
          )
            return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            renderer.render(scene, camera);
            element.dataset.cameraPosition = JSON.stringify(
              camera.position.toArray(),
            );
            element.dataset.cameraTarget = JSON.stringify(
              controls.target.toArray(),
            );
            element.dataset.cameraZoom = String(camera.zoom);
          });
        };
        const paintTheme = () => {
          const css = getComputedStyle(element);
          // CSS Color4 expressions (including color-mix) are browser data, not
          // supported THREE.Color strings. Resolve and rasterize a single sRGB
          // swatch, then supply numeric color channels to the GPU.
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          const swatch = document.createElement("span");
          swatch.style.cssText =
            "position:absolute;visibility:hidden;pointer-events:none";
          element.append(swatch);
          const color = (token: string, fallback: string) => {
            swatch.style.color = css.getPropertyValue(token).trim() || fallback;
            if (!context) return new T.Color(fallback);
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = getComputedStyle(swatch).color;
            context.fillRect(0, 0, 1, 1);
            const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
            return new T.Color().setRGB(
              r / 255,
              g / 255,
              b / 255,
              T.SRGBColorSpace,
            );
          };
          scene.background = color("--figure", "#f4f7fc");
          const low = color("--science-trna", "#138d87"),
            high = color("--science-rna", "#4566dd");
          swatch.remove();
          element.dataset.surfaceColors = JSON.stringify([
            low.getHexString(),
            high.getHexString(),
          ]);
          colors.length = 0;
          for (const value of sample.values) {
            const color = low
              .clone()
              .lerp(high, Math.log1p(value) / Math.log1p(sample.max));
            colors.push(color.r, color.g, color.b);
          }
          geometry.setAttribute(
            "color",
            new T.Float32BufferAttribute(colors, 3),
          );
          requestPaint();
        };
        const readView = (): CameraView => ({
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          zoom: camera.zoom,
        });
        read.current = readView;
        const storeView = () => setSaved(readView());
        controls.addEventListener("change", requestPaint);
        controls.addEventListener("end", storeView);
        const fit = () => {
          camera.position.set(9, -11, 10);
          camera.zoom = 1;
          controls.target.set(0, 0, 1.3);
          camera.updateProjectionMatrix();
          controls.update();
          storeView();
          requestPaint();
        };
        reset.current = fit;
        const restored = savedRef.current;
        fit();
        if (
          restored?.position.length === 3 &&
          restored.target.length === 3 &&
          [...restored.position, ...restored.target, restored.zoom].every(
            Number.isFinite,
          )
        ) {
          camera.position.fromArray(restored.position);
          controls.target.fromArray(restored.target);
          camera.zoom = Math.max(0.2, Math.min(5, restored.zoom));
          camera.updateProjectionMatrix();
          controls.update();
          storeView();
        }
        zoom.current = (amount) => {
          camera.zoom = Math.max(0.4, Math.min(4, camera.zoom * amount));
          camera.updateProjectionMatrix();
          storeView();
          requestPaint();
        };
        rotate.current = (angle) => {
          camera.position
            .sub(controls.target)
            .applyAxisAngle(new T.Vector3(0, 0, 1), angle)
            .add(controls.target);
          controls.update();
          storeView();
          requestPaint();
        };
        update.current = () => {
          const input = live.current;
          const segments = [];
          for (let index = 1; index < input.points.length; index++) {
            const a = input.points[index - 1],
              b = input.points[index];
            if (
              inLandscapeView(kind, a.point) &&
              inLandscapeView(kind, b.point)
            )
              segments.push(
                world(...a.point).add(new T.Vector3(0, 0, 0.035)),
                world(...b.point).add(new T.Vector3(0, 0, 0.035)),
              );
          }
          segments.forEach((point, index) =>
            pathAttribute.setXYZ(index, point.x, point.y, point.z),
          );
          pathAttribute.needsUpdate = true;
          pathGeometry.setDrawRange(0, segments.length);
          element.dataset.trajectoryVertices = String(segments.length);
          element.dataset.currentPosition = JSON.stringify(input.current.point);
          marker.visible = inLandscapeView(kind, input.current.point);
          if (marker.visible)
            marker.position
              .copy(world(...input.current.point))
              .add(new T.Vector3(0, 0, 0.08));
          requestPaint();
        };
        const resize = new ResizeObserver(() => {
          if (element.clientWidth <= 0) return;
          camera.aspect = element.clientWidth / 350;
          camera.updateProjectionMatrix();
          renderer.setSize(element.clientWidth, 350);
          requestPaint();
        });
        cleanups.push(() => resize.disconnect());
        resize.observe(element);
        const theme = createVisualThemeObserver(paintTheme);
        cleanups.push(() => theme.disconnect());
        theme.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style", "data-theme"],
        });
        paintTheme();
        update.current();
        setError("");
      })
      .catch((problem: unknown) => {
        dispose();
        if (alive)
          setError(
            problem instanceof Error
              ? problem.message
              : "3D rendering is unavailable.",
          );
      });
    return () => {
      alive = false;
      dispose();
    };
  }, [kind, setSaved]);
  return (
    <section className="optimization-3d" aria-label="Rotatable loss landscape">
      {error ? (
        <p className="optimization-feedback" role="status">
          3D is unavailable here. The calculated 2D explorer above remains
          usable.
        </p>
      ) : (
        <div
          ref={host}
          className="optimization-3d-canvas"
          role="img"
          aria-label="3D loss landscape. Drag to rotate; use the zoom buttons."
        />
      )}
      <div className="optimization-camera-controls">
        <span>Drag to rotate the same calculated surface.</span>
        <button onClick={() => zoom.current(1.2)}>Zoom in 3D</button>
        <button onClick={() => zoom.current(1 / 1.2)}>Zoom out 3D</button>
        <button onClick={() => rotate.current(Math.PI / 12)}>
          Rotate 3D left
        </button>
        <button onClick={() => rotate.current(-Math.PI / 12)}>
          Rotate 3D right
        </button>
        <button onClick={() => reset.current()}>Reset 3D view</button>
      </div>
      <p className="optimization-caption">
        Height shows log(1 + loss), scaled for viewing. Gradient updates use the
        original displayed loss. X and Y are the same unitless coordinates as
        the map above.
      </p>
    </section>
  );
}

export default function OptimizationLab({ spec }: { spec: IllustrationSpec }) {
  const supplied = spec.optimization,
    initialKind = isLandscape(supplied?.landscape)
      ? supplied.landscape
      : "quadratic",
    fallback = landscapes[initialKind];
  const [kindValue, setKind] = useVisualState<Landscape>(
    "optimization.landscape",
    initialKind,
  );
  const kind = isLandscape(kindValue) ? kindValue : "quadratic",
    meta = landscapes[kind];
  const [rateValue, setRate] = useVisualState(
    "optimization.learningRate",
    supplied?.learningRate ?? fallback.rate,
  );
  const [startValue, setStart] = useVisualState<Point2>(
    "optimization.start",
    supplied?.start || fallback.start,
  );
  const [iterationsValue, setIterations] = useVisualState(
    "optimization.iterations",
    supplied?.iterations ?? 120,
  );
  const [stepValue, setStep] = useVisualState("optimization.step", 0);
  const [compare, setCompare] = useVisualState("optimization.compare", false);
  const [show3d, setShow3d] = useVisualState("optimization.show3d", false);
  const [stageValue, setStage] = useVisualState("optimization.stage", 0);
  const [playing, setPlaying] = useState(false),
    [dragging, setDragging] = useState(false),
    [selected, setSelected] = useState(false);
  const runtime = useVisualRuntime(),
    host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(true),
    [documentVisible, setDocumentVisible] = useState(
      document.visibilityState !== "hidden",
    );
  const rate = finite(rateValue, meta.rate, 0.001, 1),
    iterations = Math.round(finite(iterationsValue, 120, 1, 300));
  const start: Point2 = [
    finite(startValue?.[0], meta.start[0], meta.xDomain[0], meta.xDomain[1]),
    finite(startValue?.[1], meta.start[1], meta.yDomain[0], meta.yDomain[1]),
  ];
  const trace = useMemo(
    () => descentTrace(kind, start, rate, iterations),
    [kind, start[0], start[1], rate, iterations],
  );
  const comparison = useMemo(
    () => descentTrace(kind, start, rate / 3, iterations),
    [kind, start[0], start[1], rate, iterations],
  );
  const step = Math.min(
      trace.points.length - 1,
      Math.round(finite(stepValue, 0, 0, iterations)),
    ),
    current = trace.points[step];
  const gradient = landscapeGradient(kind, current.point),
    norm = Math.hypot(...gradient),
    stage = Math.round(finite(stageValue, 0, 0, 2));
  const sample = useMemo(() => sampleLandscape(kind), [kind]);
  const contourPaths = useMemo(() => {
    const thresholds = Array.from({ length: 12 }, (_, i) =>
      Math.expm1(((i + 1) / 13) * Math.log1p(sample.max)),
    );
    const data = contours()
      .size([sample.count, sample.count])
      .thresholds(thresholds)(sample.values);
    const ring = line<number[]>()
      .x((p) => PLOT.left + ((p[0] - 0.5) / (sample.count - 1)) * PLOT.width)
      .y((p) => PLOT.top + ((p[1] - 0.5) / (sample.count - 1)) * PLOT.height);
    return data.map((contour, index) => ({
      value: contour.value,
      tone: 8 + index * 3,
      d: contour.coordinates
        .map((polygon) => polygon.map((points) => ring(points) + "Z").join(" "))
        .join(" "),
    }));
  }, [sample]);
  const x = scaleLinear()
    .domain(meta.xDomain)
    .range([PLOT.left, PLOT.left + PLOT.width]);
  const y = scaleLinear()
    .domain(meta.yDomain)
    .range([PLOT.top + PLOT.height, PLOT.top]);
  const path = line<DescentPoint>()
    .x((p) => x(p.point[0]))
    .y((p) => y(p.point[1]))
    .defined((p) => inLandscapeView(kind, p.point));
  const shown = trace.points.slice(0, step + 1),
    alternate = comparison.points.slice(
      0,
      Math.min(step + 1, comparison.points.length),
    );
  const next: Point2 = [
    current.point[0] - rate * gradient[0],
    current.point[1] - rate * gradient[1],
  ];
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const update = () =>
      setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !visible || !documentVisible || runtime?.visible === false)
      return;
    if (step >= trace.points.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setStep(step + 1),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 450 : 180,
    );
    return () => clearTimeout(timer);
  }, [
    playing,
    visible,
    documentVisible,
    runtime?.visible,
    step,
    trace.points.length,
    setStep,
  ]);
  const retune = () => {
    setPlaying(false);
    setStep(0);
  };
  const choose = (value: Landscape) => {
    setKind(value);
    setStart(landscapes[value].start);
    setRate(landscapes[value].rate);
    retune();
  };
  const pointFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const moved: Point2 = [
      Math.max(meta.xDomain[0], Math.min(meta.xDomain[1], x.invert(point.x))),
      Math.max(meta.yDomain[0], Math.min(meta.yDomain[1], y.invert(point.y))),
    ];
    setStart(moved);
    retune();
  };
  const stages = [
    {
      title: "Follow the slope",
      text: "The arrow is the next computed update. Step once and watch the point move opposite the gradient, toward a locally lower loss when the step is small enough.",
    },
    {
      title: "Change the step size",
      text: "The learning rate multiplies the gradient. Compare your rate with one-third of it. A larger step can move faster, oscillate across a valley, or increase the loss.",
    },
    {
      title: "Move the starting point",
      text: "Drag the starting marker or change X and Y. In a landscape with several basins, a new start can lead to another solution. A flat gradient alone does not prove a global minimum.",
    },
  ];
  const status =
    step === trace.points.length - 1
      ? trace.message
      : !inLandscapeView(kind, current.point)
        ? "The calculated point has left the displayed map. The calculation has not been clamped to its edge. Reduce the learning rate or reset."
        : stages[stage].text;
  return (
    <div ref={host} className="optimization-lab" data-optimization-kind={kind}>
      <p className="optimization-intro">
        Drag the starting point, then take a step. Watch how changing the{" "}
        <strong>learning rate</strong> changes the path, not the landscape.
      </p>
      <div
        className="optimization-learning-stages"
        aria-label="Optimization exploration"
      >
        {stages.map((item, index) => (
          <button
            key={item.title}
            aria-pressed={stage === index}
            onClick={() => {
              setStage(index);
              if (index === 1) setCompare(true);
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className="optimization-chart-scroll">
        <svg
          ref={svg}
          className="optimization-chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${meta.name}: calculated loss contours and gradient descent trajectory`}
          onPointerMove={(event) => {
            if (dragging) pointFromPointer(event);
          }}
          onPointerUp={(event) => {
            if (dragging) {
              setDragging(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={() => setDragging(false)}
          onLostPointerCapture={() => setDragging(false)}
        >
          <title>
            Change a starting point and learning rate to explore calculated
            gradient descent
          </title>
          <desc>
            Contour lines connect equal losses. Blue is your chosen learning
            rate. The dashed amber line is one-third of that rate when
            comparison is enabled. Orange marks the current point.
          </desc>
          <defs>
            <clipPath id={`loss-clip-${id}`}>
              <rect
                x={PLOT.left}
                y={PLOT.top}
                width={PLOT.width}
                height={PLOT.height}
              />
            </clipPath>
            <marker
              id={`loss-arrow-${id}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,0L10,5L0,10Z" fill="var(--science-amino,#d96a42)" />
            </marker>
          </defs>
          <rect
            className="optimization-map-bg"
            x={PLOT.left}
            y={PLOT.top}
            width={PLOT.width}
            height={PLOT.height}
          />
          <g clipPath={`url(#loss-clip-${id})`}>
            {contourPaths.map((contour) => (
              <path
                key={contour.value}
                className="optimization-contour"
                data-loss={contour.value}
                d={contour.d}
                fillRule="evenodd"
                style={{
                  fill: `color-mix(in srgb,var(--science-rna,#4566dd) ${contour.tone}%,var(--figure))`,
                }}
              />
            ))}
            {x.ticks(8).map((tick) => (
              <line
                key={`x${tick}`}
                className="optimization-grid"
                x1={x(tick)}
                x2={x(tick)}
                y1={PLOT.top}
                y2={PLOT.top + PLOT.height}
              />
            ))}
            {y.ticks(6).map((tick) => (
              <line
                key={`y${tick}`}
                className="optimization-grid"
                y1={y(tick)}
                y2={y(tick)}
                x1={PLOT.left}
                x2={PLOT.left + PLOT.width}
              />
            ))}
            {compare && (
              <path
                className="optimization-comparison-path"
                data-testid="optimization-comparison-path"
                d={path(alternate) || undefined}
              />
            )}
            <path
              className="optimization-trajectory"
              data-testid="optimization-trajectory"
              d={path(shown) || undefined}
            />
            {inLandscapeView(kind, current.point) && (
              <line
                className="optimization-next-vector"
                x1={x(current.point[0])}
                y1={y(current.point[1])}
                x2={x(next[0])}
                y2={y(next[1])}
                markerEnd={`url(#loss-arrow-${id})`}
              />
            )}
            {inLandscapeView(kind, current.point) && (
              <circle
                className="optimization-current"
                cx={x(current.point[0])}
                cy={y(current.point[1])}
                r="7"
              />
            )}
          </g>
          <circle
            className="optimization-start"
            cx={x(start[0])}
            cy={y(start[1])}
            r="12"
            role="button"
            tabIndex={0}
            aria-label="Move optimization starting point. Use arrow keys or the X and Y controls."
            onPointerDown={(event) => {
              event.stopPropagation();
              setDragging(true);
              setSelected(true);
              svg.current?.setPointerCapture(event.pointerId);
              retune();
            }}
            onClick={() => setSelected(true)}
            onKeyDown={(event) => {
              const directions: Record<string, Point2> = {
                ArrowLeft: [-0.1, 0],
                ArrowRight: [0.1, 0],
                ArrowUp: [0, 0.1],
                ArrowDown: [0, -0.1],
              };
              const direction = directions[event.key];
              if (direction) {
                event.preventDefault();
                setStart([
                  Math.max(
                    meta.xDomain[0],
                    Math.min(meta.xDomain[1], start[0] + direction[0]),
                  ),
                  Math.max(
                    meta.yDomain[0],
                    Math.min(meta.yDomain[1], start[1] + direction[1]),
                  ),
                ]);
                setSelected(true);
                retune();
              }
            }}
          />
          <text
            className="optimization-start-label"
            x={Math.min(PLOT.left + PLOT.width - 52, x(start[0]) + 18)}
            y={Math.max(PLOT.top + 23, y(start[1]) - 16)}
          >
            Start
          </text>
          {x.ticks(8).map((tick) => (
            <text
              key={`xt${tick}`}
              className="optimization-tick"
              textAnchor="middle"
              x={x(tick)}
              y={PLOT.top + PLOT.height + 29}
            >
              {tick}
            </text>
          ))}
          {y.ticks(6).map((tick) => (
            <text
              key={`yt${tick}`}
              className="optimization-tick"
              textAnchor="end"
              x={PLOT.left - 13}
              y={y(tick) + 7}
            >
              {tick}
            </text>
          ))}
          <text
            className="optimization-axis-title"
            x={PLOT.left + PLOT.width / 2}
            y={HEIGHT - 16}
            textAnchor="middle"
          >
            X coordinate (unitless)
          </text>
          <text
            className="optimization-axis-title"
            x="21"
            y={PLOT.top + PLOT.height / 2}
            textAnchor="middle"
            transform={`rotate(-90 21 ${PLOT.top + PLOT.height / 2})`}
          >
            Y coordinate (unitless)
          </text>
        </svg>
      </div>
      <div className="optimization-legend">
        <span>
          <i className="optimization-primary-swatch" />
          Your rate {number(rate)}
        </span>
        {compare && (
          <span>
            <i className="optimization-alternate-swatch" />
            One-third rate {number(rate / 3)}
          </span>
        )}
        <span>Contours join equal loss. Darker regions have higher loss.</span>
      </div>
      <div className="optimization-controls">
        <label>
          Loss landscape
          <select
            aria-label="Optimization landscape"
            value={kind}
            onChange={(event) => choose(event.target.value as Landscape)}
          >
            {(Object.keys(landscapes) as Landscape[]).map((value) => (
              <option key={value} value={value}>
                {landscapes[value].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Learning rate <output>{number(rate)}</output>
          <input
            type="range"
            aria-label="Optimization learning rate"
            min="0.001"
            max="1"
            step="0.001"
            value={rate}
            onChange={(event) => {
              setRate(Number(event.target.value));
              retune();
            }}
          />
        </label>
        <label>
          Starting X <output>{number(start[0])}</output>
          <input
            type="range"
            aria-label="Optimization starting X"
            min={meta.xDomain[0]}
            max={meta.xDomain[1]}
            step="0.05"
            value={start[0]}
            onChange={(event) => {
              setStart([Number(event.target.value), start[1]]);
              retune();
            }}
          />
        </label>
        <label>
          Starting Y <output>{number(start[1])}</output>
          <input
            type="range"
            aria-label="Optimization starting Y"
            min={meta.yDomain[0]}
            max={meta.yDomain[1]}
            step="0.05"
            value={start[1]}
            onChange={(event) => {
              setStart([start[0], Number(event.target.value)]);
              retune();
            }}
          />
        </label>
      </div>
      <div className="optimization-playback">
        <button
          onClick={() => {
            if (step >= trace.points.length - 1) setStep(0);
            setPlaying(!playing);
          }}
          aria-pressed={playing}
        >
          {playing ? "Pause updates" : "Play updates"}
        </button>
        <button
          disabled={step >= trace.points.length - 1}
          onClick={() => {
            setPlaying(false);
            setStep(Math.min(step + 1, trace.points.length - 1));
          }}
        >
          Take one step
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setKind(initialKind);
            setStart(supplied?.start || fallback.start);
            setRate(supplied?.learningRate ?? fallback.rate);
            setIterations(supplied?.iterations ?? 120);
            setStep(0);
            setCompare(false);
            setStage(0);
          }}
        >
          Reset experiment
        </button>
        <label className="optimization-comparison-toggle">
          <input
            type="checkbox"
            checked={compare === true}
            onChange={(event) => setCompare(event.target.checked)}
          />
          Compare step sizes
        </label>
        <button
          aria-expanded={show3d === true}
          onClick={() => setShow3d(!show3d)}
        >
          {show3d ? "Hide 3D landscape" : "Explore in 3D"}
        </button>
      </div>
      <label className="optimization-scrubber">
        Inspect update{" "}
        <output>
          {step} of {trace.points.length - 1}
        </output>
        <input
          type="range"
          aria-label="Optimization update"
          min="0"
          max={Math.max(1, trace.points.length - 1)}
          step="1"
          value={step}
          disabled={trace.points.length < 2}
          onChange={(event) => {
            setPlaying(false);
            setStep(Number(event.target.value));
          }}
        />
      </label>
      <div
        className="optimization-readout"
        aria-label="Calculated optimization state"
      >
        <span>
          Position{" "}
          <strong data-testid="optimization-position">
            ({number(current.point[0])}, {number(current.point[1])})
          </strong>
        </span>
        <span>
          Loss{" "}
          <strong data-testid="optimization-loss">
            {number(current.loss)}
          </strong>
        </span>
        <span>
          Gradient{" "}
          <strong>
            ({number(gradient[0])}, {number(gradient[1])})
          </strong>
        </span>
        <span>
          Gradient length <strong>{number(norm)}</strong>
        </span>
      </div>
      <p className="optimization-feedback" role="status">
        {selected && step === 0
          ? "You chose the starting point. The circle is a coordinate you control, not a physical ball. Press Take one step to apply the displayed update rule."
          : status}
      </p>
      <div className="optimization-equation">
        <strong>{meta.formula}</strong>
        <span>Next position = current position − learning rate × gradient</span>
      </div>
      {show3d === true && (
        <Landscape3D kind={kind} points={shown} current={current} />
      )}
      <details className="optimization-assumptions">
        <summary>Model, data and limits</summary>
        <p>
          {meta.description} These are exact analytic test functions with
          deterministic full-gradient updates. They do not model a particular
          trained network. Learning rate, coordinates and loss are unitless.
          Curves that leave the view are not silently clamped. A small gradient
          can also occur at a saddle or maximum.
        </p>
        <p>
          <a
            href="https://www.deeplearningbook.org/contents/numerical.html"
            target="_blank"
            rel="noreferrer"
          >
            Gradient-based optimization reference
          </a>
          {kind === "ravine" && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://www.sfu.ca/~ssurjano/rosen.html"
                target="_blank"
                rel="noreferrer"
              >
                Rosenbrock test function
              </a>
            </>
          )}
          {kind === "himmelblau" && (
            <>
              {" "}
              ·{" "}
              <a
                href="https://cpp.api.tudat.space/tutorials/applicationWalkthroughs/himmelblau.html"
                target="_blank"
                rel="noreferrer"
              >
                Himmelblau implementation reference
              </a>
            </>
          )}
        </p>
        <table>
          <caption>Calculated updates, first 12 positions</caption>
          <thead>
            <tr>
              <th scope="col">Update</th>
              <th scope="col">X</th>
              <th scope="col">Y</th>
              <th scope="col">Loss</th>
            </tr>
          </thead>
          <tbody>
            {trace.points.slice(0, 12).map((point) => (
              <tr key={point.step}>
                <td>{point.step}</td>
                <td>{number(point.point[0])}</td>
                <td>{number(point.point[1])}</td>
                <td>{number(point.loss)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
