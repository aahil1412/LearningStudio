import { readFile } from "node:fs/promises";
import type { MainModule } from "@rdkit/rdkit";
let modulePromise: Promise<MainModule> | undefined;
async function load() {
  if (!modulePromise)
    modulePromise = (async () => {
      const factory = (await import("@rdkit/rdkit")).default;
      const wasmBinary = await readFile(
        require.resolve("@rdkit/rdkit/RDKit_minimal.wasm"),
      );
      return await factory({ wasmBinary });
    })();
  return modulePromise;
}
function color(value: unknown) {
  if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value))
    throw new Error("Use six-digit theme colors.");
  return [1, 3, 5].map(
    (index) => parseInt(value.slice(index, index + 2), 16) / 255,
  );
}
export async function renderChemical(payload: unknown) {
  const value = payload as {
    input?: unknown;
    format?: unknown;
    theme?: { background?: unknown; text?: unknown };
  };
  if (
    typeof value?.input !== "string" ||
    !value.input.trim() ||
    value.input.length > 200000 ||
    !["smiles", "mol", "sdf"].includes(String(value.format))
  )
    throw new Error(
      "Provide a valid SMILES, MOL, or SDF structure under 200 KB.",
    );
  if (
    value.format === "smiles" &&
    (value.input.length > 4000 || /[\r\n]/.test(value.input))
  )
    throw new Error("Provide one SMILES structure under 4,000 characters.");
  const background = color(value.theme?.background),
    text = color(value.theme?.text);
  const rdkit = await load();
  let molecule: ReturnType<MainModule["get_mol"]> | undefined;
  try {
    molecule = rdkit.get_mol(
      value.format === "sdf" ? value.input.split("$$$$")[0] : value.input,
    );
    if (!molecule?.is_valid())
      throw new Error(
        "RDKit could not validate this structure. Check its chemical source.",
      );
    const atoms =
      JSON.parse(molecule.get_json()).molecules?.[0]?.atoms?.length ?? 0;
    if (atoms > 1200)
      throw new Error("Choose a structure with at most 1,200 atoms.");
    molecule.set_new_coords();
    const svg = molecule.get_svg_with_highlights(
      JSON.stringify({
        width: 440,
        height: 320,
        clearBackground: true,
        backgroundColour: [...background, 1],
        legendColour: text,
        symbolColour: text,
        atomColourPalette: { "0": text, "1": text, "6": text },
        bondLineWidth: 1.8,
      }),
    );
    if (
      !svg.includes("<svg") ||
      /<script|foreignObject|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:)/i.test(
        svg,
      )
    )
      throw new Error("The trusted renderer returned an unexpected SVG shape.");
    return {
      svg,
      smiles: molecule.get_smiles(),
      atoms,
      version: rdkit.version(),
    };
  } finally {
    molecule?.delete();
  }
}
