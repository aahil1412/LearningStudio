import { useEffect, useMemo, useRef, useState } from "react";
import {
  alignPdb,
  alignSdf,
  parseResidueSelection,
  pdbTrajectory,
} from "../../lib/science/molecular";
import { chemicalSvg } from "../../lib/science/chemistry";
import {
  createVisualThemeObserver,
  useVisualRuntime,
  useVisualSource,
  useVisualState,
} from "../../lib/visualState";
export type MolecularData = {
  data: string;
  format: string;
  sourceUrl?: string;
  name?: string;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The molecular operation could not be completed.";
function dataUrl(svg: string) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
export function ChemicalView({
  input,
  format,
  caption,
}: {
  input: string;
  format: "smiles" | "mol" | "sdf";
  caption?: string;
}) {
  const [result, setResult] = useState<{
      svg: string;
      smiles: string;
      atoms: number;
      version: string;
    } | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [expanded, setExpanded] = useState(false);
  const runtime = useVisualRuntime();
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [expanded]);
  useEffect(() => {
    const observer = createVisualThemeObserver(() => setRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    setError("");
    const css = getComputedStyle(document.documentElement);
    chemicalSvg(input, format, {
      background: css.getPropertyValue("--figure").trim(),
      text: css.getPropertyValue("--text").trim(),
    })
      .then((value) => {
        if (alive) setResult(value);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [input, format, revision]);
  return (
    <section
      className={`visual-figure local-chemistry ${expanded ? "visual-expanded" : ""}`}
      aria-label={caption || "Local chemical structure"}
    >
      <header className="visual-figure-header">
        <div>
          <span className="visual-tag">Local RDKit chemical renderer</span>
          <h4>{caption || "Validated chemical connectivity"}</h4>
        </div>
        <div className="visual-toolbar">
          <button
            disabled={!result}
            aria-label="Export local chemical SVG"
            onClick={() => {
              if (!result) return;
              const a = document.createElement("a");
              a.href = dataUrl(result.svg);
              a.download = "chemical-structure.svg";
              a.click();
            }}
          >
            ↓
          </button>
          <button
            aria-label="Expand local chemical structure"
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
      {error ? (
        <div className="visual-error" role="status">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>
            Retry chemistry renderer
          </button>
        </div>
      ) : result ? (
        <>
          <img
            className="local-chemical-svg"
            src={dataUrl(result.svg)}
            alt="RDKit validated chemical structure diagram"
          />
          <p className="visual-caption">
            {result.atoms} atoms · RDKit {result.version} · 2D coordinates
            computed locally from validated connectivity.{" "}
            <code>{result.smiles}</code>
          </p>
        </>
      ) : (
        <p className="visual-status">Initializing local chemistry toolkit…</p>
      )}
    </section>
  );
}
export function ChemistryLab({
  structure,
}: {
  structure: MolecularData | null;
}) {
  const [input, setInput] = useVisualState(
      "chemical.editor.input",
      "CC(=O)Oc1ccccc1C(=O)O",
    ),
    [format, setFormat] = useVisualState<"smiles" | "mol" | "sdf">(
      "chemical.editor.format",
      "smiles",
    ),
    [applied, setApplied] = useVisualSource<{
      input: string;
      format: "smiles" | "mol" | "sdf";
    }>("chemical.editor.applied"),
    [error, setError] = useState("");
  return (
    <details className="molecular-advanced">
      <summary>Local chemical structure diagrams</summary>
      <p>
        Render supplied SMILES or a source MOL/SDF entirely on this device.
        RDKit validates bonds and computes 2D layout; no model-created
        coordinates are used.
      </p>
      <label>
        Structure format
        <select
          aria-label="Local chemical format"
          value={format}
          onChange={(e) =>
            setFormat(e.target.value as "smiles" | "mol" | "sdf")
          }
        >
          <option value="smiles">SMILES</option>
          <option value="mol">MOL</option>
          <option value="sdf">SDF (first record)</option>
        </select>
      </label>
      <textarea
        aria-label="Local chemical input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={200000}
      />
      <div className="visual-action-row">
        <button
          onClick={() => {
            setApplied({ input, format });
            setError("");
          }}
        >
          Render chemical structure locally
        </button>
        <button
          disabled={
            !structure ||
            !["sdf", "mol"].includes(structure.format.toLowerCase())
          }
          onClick={() => {
            if (structure) {
              setInput(structure.data);
              setFormat(structure.format.toLowerCase() as "sdf" | "mol");
              setApplied({
                input: structure.data,
                format: structure.format.toLowerCase() as "sdf" | "mol",
              });
            }
          }}
        >
          Use loaded molecule
        </button>
        <button
          onClick={async () => {
            try {
              const item = await window.studio?.invoke<MolecularData | null>(
                "structure:import",
              );
              if (item) {
                if (!["sdf", "mol"].includes(item.format.toLowerCase()))
                  throw new Error(
                    "Choose a MOL or SDF source for chemical connectivity.",
                  );
                setInput(item.data);
                setFormat(item.format.toLowerCase() as "sdf" | "mol");
                setApplied({
                  input: item.data,
                  format: item.format.toLowerCase() as "sdf" | "mol",
                });
              }
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          Open chemical file
        </button>
      </div>
      {error && <div className="visual-error">{error}</div>}
      {applied && <ChemicalView {...applied} />}
    </details>
  );
}
export function MolecularAdvancedPanel({
  structure,
  comparison,
  onAligned,
  onSelection,
  onFrame,
}: {
  structure: MolecularData | null;
  comparison: MolecularData | null;
  onAligned: (value: MolecularData) => void;
  onSelection: (value: Record<string, unknown>) => number | void;
  onFrame: (data: string | null, index: number) => void;
}) {
  const runtime = useVisualRuntime(),
    restored = useRef(
      !!runtime && Object.hasOwn(runtime.state, "molecule.trajectory.frame"),
    );
  const [error, setError] = useState(""),
    [alignment, setAlignment] = useVisualState("molecule.alignmentInfo", ""),
    [expression, setExpression] = useVisualState(
      "molecule.expression",
      "chain:A resi:1-10",
    ),
    [selection, setSelection] = useVisualState("molecule.expressionResult", ""),
    [frame, setFrame] = useVisualState("molecule.trajectory.frame", 0),
    [playing, setPlaying] = useVisualState(
      "molecule.trajectory.playing",
      false,
    );
  const trajectory = useMemo(() => {
    try {
      return {
        frames:
          structure?.format === "pdb" ? pdbTrajectory(structure.data) : [],
        error: "",
      };
    } catch (error) {
      return { frames: [], error: message(error) };
    }
  }, [structure]);
  useEffect(() => {
    if (!structure) return;
    if (restored.current) {
      restored.current = false;
      const index = Math.min(frame, Math.max(0, trajectory.frames.length - 1));
      onFrame(trajectory.frames[index] ?? null, index);
      return;
    }
    setFrame(0);
    setPlaying(false);
    setAlignment("");
    onFrame(trajectory.frames[0] ?? null, 0);
  }, [structure]);
  useEffect(() => {
    if (!playing || runtime?.visible === false || trajectory.frames.length < 2)
      return;
    const handle = setInterval(
      () =>
        setFrame((value) => {
          const next = (value + 1) % trajectory.frames.length;
          onFrame(trajectory.frames[next], next);
          return next;
        }),
      120,
    );
    return () => clearInterval(handle);
  }, [playing, trajectory, onFrame, runtime?.visible]);
  const align = () => {
    try {
      if (!structure || !comparison)
        throw new Error("Load a comparison structure first.");
      let value;
      if (structure.format === "pdb" && comparison.format === "pdb")
        value = alignPdb(
          trajectory.frames[frame] ?? structure.data,
          pdbTrajectory(comparison.data)[0] ?? comparison.data,
        );
      else if (
        ["mol", "sdf"].includes(structure.format) &&
        ["mol", "sdf"].includes(comparison.format)
      )
        value = alignSdf(structure.data, comparison.data);
      else
        throw new Error(
          "Choose comparable PDB structures, or MOL/SDF files with matching ordered chemical topology.",
        );
      onAligned({ ...comparison, data: value.data });
      setAlignment(
        `Aligned ${value.count} ${value.method}. RMSD = ${value.rmsd.toFixed(5)} Å. Rotation and translation only; no reflection or deformation.`,
      );
      setError("");
    } catch (error) {
      setError(message(error));
    }
  };
  return (
    <details className="molecular-advanced">
      <summary>Alignment, selection & trajectory tools</summary>
      <label>
        Residue / atom selection
        <input
          aria-label="Residue expression"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          maxLength={200}
        />
      </label>
      <div className="visual-action-row">
        <button
          onClick={() => {
            try {
              const count = onSelection(parseResidueSelection(expression));
              setSelection(
                typeof count === "number"
                  ? `${count} atoms selected.`
                  : "Selection applied.",
              );
              setError("");
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          Apply molecular selection
        </button>
        <button disabled={!comparison} onClick={align}>
          Align comparison & calculate RMSD
        </button>
      </div>
      <p className="visual-caption">
        Grammar: chain:A resi:1-10 atom:CA resn:ALA elem:C. Space combines
        fields; commas select multiple values.
      </p>
      {selection && <p role="status">{selection}</p>}
      {alignment && (
        <p className="molecular-alignment" role="status">
          {alignment}
        </p>
      )}
      {(error || trajectory.error) && (
        <div className="visual-error" role="status">
          {error || trajectory.error}
        </div>
      )}
      {trajectory.frames.length > 1 ? (
        <div className="science-playback">
          <strong>
            Compatible PDB trajectory · {trajectory.frames.length} frames
          </strong>
          <button onClick={() => setPlaying((v) => !v)}>
            {playing ? "Pause trajectory" : "Play trajectory"}
          </button>
          <input
            aria-label="Molecular trajectory frame"
            type="range"
            min="0"
            max={trajectory.frames.length - 1}
            value={frame}
            onChange={(e) => {
              const index = Number(e.target.value);
              setFrame(index);
              setPlaying(false);
              onFrame(trajectory.frames[index], index);
            }}
          />
          <span>
            Frame {frame + 1} of {trajectory.frames.length}
          </span>
        </div>
      ) : (
        <p className="visual-caption">
          Open a PDB with compatible MODEL / ENDMDL records to play a supplied
          trajectory. Frame topology is checked before playback.
        </p>
      )}
    </details>
  );
}
