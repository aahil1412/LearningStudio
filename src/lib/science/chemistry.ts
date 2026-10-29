import loaderUrl from "@rdkit/rdkit?url";
import wasmUrl from "@rdkit/rdkit/RDKit_minimal.wasm?url";
let promise: Promise<any> | undefined;
export function loadChemistry(): Promise<any> {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const start = async () => {
      try {
        const init = (window as any).initRDKitModule;
        if (typeof init !== "function")
          throw new Error("The local chemistry module did not initialize.");
        const options: any = {
          locateFile: (path: string) =>
            path.endsWith(".wasm") ? wasmUrl : path,
        };
        if (window.studio) {
          try {
            const base64 = await window.studio.invoke<string>("chemistry:wasm");
            const bytes = Uint8Array.from(atob(base64), (v) => v.charCodeAt(0));
            options.wasmBinary = bytes;
          } catch {
            /* Browser-compatible asset loading remains available. */
          }
        }
        resolve(await init(options));
      } catch (error) {
        promise = undefined;
        reject(error);
      }
    };
    if (typeof (window as any).initRDKitModule === "function") {
      void start();
      return;
    }
    const script = document.createElement("script");
    script.src = loaderUrl;
    script.onload = () => void start();
    script.onerror = () => {
      promise = undefined;
      script.remove();
      reject(new Error("The bundled chemistry renderer could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return promise;
}
function rgb(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  return match
    ? [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16) / 255)
    : [0.2, 0.2, 0.2];
}
export async function chemicalSvg(
  input: string,
  format: "smiles" | "mol" | "sdf",
  theme: { background: string; text: string },
) {
  if (!input.trim() || input.length > 200000)
    throw new Error("Use a SMILES or MOL/SDF structure smaller than 200 KB.");
  if (format === "smiles" && (input.length > 4000 || /[\r\n]/.test(input)))
    throw new Error("Enter one SMILES structure of at most 4000 characters.");
  // The desktop runs the trusted compiled toolkit outside the CSP-restricted reading renderer.
  // Only chemical data and appearance tokens cross this narrow boundary, never executable code.
  if (window.studio)
    return window.studio.invoke<{
      svg: string;
      smiles: string;
      atoms: number;
      version: string;
    }>("chemistry:render", { input, format, theme });
  const rdkit = await loadChemistry(),
    source = format === "sdf" ? input.split("$$$$")[0] : input;
  let molecule: any;
  try {
    molecule = rdkit.get_mol(source);
    if (!molecule || !molecule.is_valid())
      throw new Error(
        "RDKit could not validate this chemical structure. Check the source SMILES or MOL/SDF record.",
      );
    const atoms =
      molecule.get_num_atoms?.() ??
      JSON.parse(molecule.get_json()).molecules?.[0]?.atoms?.length;
    if (atoms > 1200)
      throw new Error(
        "Choose a small molecule with at most 1200 atoms for a readable 2D diagram.",
      );
    molecule.set_new_coords?.();
    const text = rgb(theme.text);
    const svg = molecule.get_svg_with_highlights(
      JSON.stringify({
        width: 440,
        height: 320,
        clearBackground: true,
        backgroundColour: [...rgb(theme.background), 1],
        legendColour: text,
        symbolColour: text,
        atomColourPalette: { "0": text, "1": text, "6": text },
        bondLineWidth: 1.8,
      }),
    );
    if (typeof svg !== "string" || !svg.includes("<svg"))
      throw new Error("The chemistry renderer returned an invalid depiction.");
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
