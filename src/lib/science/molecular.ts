import { Matrix, SingularValueDecomposition } from "ml-matrix";
export type Point3 = [number, number, number];
const sub = (a: Point3, b: Point3): Point3 =>
  a.map((v, i) => v - b[i]) as Point3;
const dot = (a: Point3, b: Point3) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Point3): Point3 => {
  const length = Math.hypot(...v);
  if (length < 1e-12)
    throw new Error("The selected atoms do not define a unique measurement.");
  return v.map((n) => n / length) as Point3;
};
export const atomPoint = (atom: {
  x: number;
  y: number;
  z: number;
}): Point3 => [atom.x, atom.y, atom.z];
export const atomicDistance = (a: Point3, b: Point3) =>
  Math.hypot(...sub(a, b));
export function atomicAngle(a: Point3, b: Point3, c: Point3) {
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(1, dot(normalize(sub(a, b)), normalize(sub(c, b)))),
      ),
    ) *
      180) /
    Math.PI
  );
}
export function atomicTorsion(a: Point3, b: Point3, c: Point3, d: Point3) {
  const axis = normalize(sub(c, b)),
    ab = sub(a, b),
    dc = sub(d, c),
    v = normalize(sub(ab, axis.map((n) => n * dot(ab, axis)) as Point3)),
    w = normalize(sub(dc, axis.map((n) => n * dot(dc, axis)) as Point3));
  return (Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180) / Math.PI;
}
function determinant(m: Matrix) {
  return (
    m.get(0, 0) * (m.get(1, 1) * m.get(2, 2) - m.get(1, 2) * m.get(2, 1)) -
    m.get(0, 1) * (m.get(1, 0) * m.get(2, 2) - m.get(1, 2) * m.get(2, 0)) +
    m.get(0, 2) * (m.get(1, 0) * m.get(2, 1) - m.get(1, 1) * m.get(2, 0))
  );
}
/** Rigid Kabsch alignment: mobile column coordinates are rotated onto reference. */
export function kabsch(reference: Point3[], mobile: Point3[]) {
  if (
    reference.length !== mobile.length ||
    reference.length < 3 ||
    reference.length > 100000 ||
    [...reference, ...mobile].some(
      (p) => p.length !== 3 || p.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error(
      "Alignment requires 3–100000 matched finite atomic coordinates.",
    );
  const centroid = (points: Point3[]): Point3 =>
    [0, 1, 2].map(
      (j) => points.reduce((sum, p) => sum + p[j], 0) / points.length,
    ) as Point3;
  const refCenter = centroid(reference),
    mobileCenter = centroid(mobile),
    a = mobile.map((p) => sub(p, mobileCenter)),
    b = reference.map((p) => sub(p, refCenter));
  const covariance = Matrix.zeros(3, 3);
  for (let k = 0; k < a.length; k++)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        covariance.set(i, j, covariance.get(i, j) + a[k][i] * b[k][j]);
  const svd = new SingularValueDecomposition(covariance, {
    autoTranspose: true,
  });
  if (svd.diagonal.filter((value) => value > 1e-10).length < 2)
    throw new Error(
      "Collinear or coincident atoms cannot define a unique rigid alignment.",
    );
  const u = svd.leftSingularVectors,
    v = svd.rightSingularVectors,
    correction = Matrix.eye(3);
  if (determinant(v.mmul(u.transpose())) < 0) correction.set(2, 2, -1);
  const rotation = v.mmul(correction).mmul(u.transpose());
  const transform = (point: Point3): Point3 => {
    const centered = sub(point, mobileCenter);
    return [0, 1, 2].map(
      (i) =>
        refCenter[i] +
        [0, 1, 2].reduce((sum, j) => sum + rotation.get(i, j) * centered[j], 0),
    ) as Point3;
  };
  const aligned = mobile.map(transform),
    rmsd = Math.sqrt(
      aligned.reduce(
        (sum, p, i) => sum + atomicDistance(p, reference[i]) ** 2,
        0,
      ) / reference.length,
    );
  return {
    rmsd,
    aligned,
    rotation: rotation.to2DArray(),
    referenceCenter: refCenter,
    mobileCenter,
    transform,
    count: reference.length,
  };
}
export function parseResidueSelection(
  expression: string,
): Record<string, unknown> {
  if (expression.length > 200)
    throw new Error("Selection expressions are limited to 200 characters.");
  const selection: Record<string, unknown> = {};
  if (!expression.trim()) return selection;
  for (const clause of expression.trim().split(/\s+/)) {
    const match = /^(chain|resi|resn|atom|elem):([A-Za-z0-9_,*-]+)$/.exec(
      clause,
    );
    if (!match)
      throw new Error(
        "Use chain:A resi:1-10 atom:CA resn:ALA elem:C. Combine clauses with spaces.",
      );
    const [, key, value] = match;
    if (Object.hasOwn(selection, key))
      throw new Error("Specify each selection field only once.");
    if (key === "resi") {
      const values: number[] = [];
      for (const part of value.split(",")) {
        const range = /^(-?\d{1,5})(?:-(-?\d{1,5}))?$/.exec(part);
        if (!range)
          throw new Error(
            "Residue numbers must be integers or bounded ranges.",
          );
        const first = Number(range[1]),
          last = Number(range[2] ?? first);
        if (last < first || last - first > 2000)
          throw new Error(
            "Residue ranges must be ascending and contain at most 2001 residues.",
          );
        for (let i = first; i <= last; i++) values.push(i);
      }
      selection[key] = values;
    } else {
      if (value === "*") continue;
      const values = value.split(",");
      if (values.some((v) => !v || v.length > 8))
        throw new Error("Invalid molecular selection value.");
      selection[key] = values.length === 1 ? values[0] : values;
    }
  }
  return selection;
}
export type PdbAtom = {
  line: number;
  key: string;
  name: string;
  element: string;
  point: Point3;
};
export function pdbAtoms(data: string, includeAlternates = false): PdbAtom[] {
  const atoms: PdbAtom[] = [];
  const lines = data.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^(ATOM {2}|HETATM)/.test(line)) continue;
    const alt = line[16];
    if (!includeAlternates && alt && alt !== " " && alt !== "A") continue;
    if (
      line.length < 54 ||
      [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)].some(
        (v) => !v.trim(),
      )
    )
      throw new Error("The PDB contains incomplete coordinates.");
    const point = [
      Number(line.slice(30, 38)),
      Number(line.slice(38, 46)),
      Number(line.slice(46, 54)),
    ] as Point3;
    if (point.some((v) => !Number.isFinite(v)))
      throw new Error("The PDB contains invalid coordinates.");
    const name = line.slice(12, 16).trim();
    atoms.push({
      line: i,
      key: `${line.slice(21, 22)}:${line.slice(22, 27).trim()}:${name}`,
      name,
      element: line.slice(76, 78).trim() || name[0],
      point,
    });
  }
  if (atoms.length > 100000)
    throw new Error("The structure exceeds the 100000-atom comparison limit.");
  return atoms;
}
export function pdbTrajectory(data: string) {
  if (data.length > 20_000_000)
    throw new Error("Trajectory files must be smaller than 20 MB.");
  const frames: string[] = [];
  let frame: string[] | null = null;
  for (const line of data.split(/\r?\n/)) {
    if (/^MODEL\s/.test(line)) {
      if (frame) throw new Error("A PDB MODEL is missing ENDMDL.");
      frame = [];
    } else if (/^ENDMDL/.test(line)) {
      if (!frame) throw new Error("Unexpected ENDMDL.");
      frames.push(frame.join("\n") + "\nEND\n");
      frame = null;
      if (frames.length > 500)
        throw new Error("Use at most 500 compatible PDB models.");
    } else if (frame) frame.push(line);
  }
  if (frame) throw new Error("The final PDB MODEL is incomplete.");
  if (!frames.length) return [];
  const topology = pdbAtoms(frames[0]).map((a) => a.key + ":" + a.element);
  if (!topology.length) throw new Error("The trajectory contains no atoms.");
  for (const value of frames.slice(1)) {
    const atoms = pdbAtoms(value);
    if (
      atoms.length !== topology.length ||
      atoms.some((a, i) => a.key + ":" + a.element !== topology[i])
    )
      throw new Error(
        "PDB trajectory models must have identical ordered atom identities.",
      );
  }
  return frames;
}
export function alignPdb(reference: string, mobile: string) {
  const ref = pdbAtoms(reference),
    moving = pdbAtoms(mobile);
  const lookup = new Map(ref.map((atom) => [atom.key, atom]));
  let matches = moving.flatMap((atom) => {
    const target = lookup.get(atom.key);
    return target && target.element === atom.element
      ? [{ mobile: atom, reference: target }]
      : [];
  });
  const ca = matches.filter((m) => m.mobile.name === "CA");
  if (ca.length >= 3) matches = ca;
  if (matches.length < 3)
    throw new Error(
      "At least three corresponding PDB atoms are required. Match chain and residue numbering before comparison.",
    );
  const alignment = kabsch(
      matches.map((m) => m.reference.point),
      matches.map((m) => m.mobile.point),
    ),
    lines = mobile.split(/\r?\n/);
  for (const atom of pdbAtoms(mobile, true)) {
    const p = alignment.transform(atom.point);
    if (p.some((v) => Math.abs(v) > 9999))
      throw new Error("Aligned coordinates exceed PDB field limits.");
    lines[atom.line] =
      lines[atom.line].slice(0, 30) +
      p.map((v) => v.toFixed(3).padStart(8)).join("") +
      lines[atom.line].slice(54);
  }
  return {
    data: lines.join("\n"),
    rmsd: alignment.rmsd,
    count: matches.length,
    method: ca.length >= 3 ? "matched Cα atoms" : "matched atom names",
  };
}
/** Ordered MOL/SDF topology must match exactly; no guessed chemical atom mapping. */
export function alignSdf(reference: string, mobile: string) {
  const parse = (data: string) => {
    const lines = data.split(/\r?\n/);
    if (!/V2000/.test(lines[3] ?? ""))
      throw new Error(
        "Small-molecule alignment currently requires MOL/SDF V2000 with explicit matching topology.",
      );
    const count = Number(lines[3].slice(0, 3)),
      bonds = Number(lines[3].slice(3, 6));
    if (!count || count > 5000) throw new Error("Invalid MOL atom count.");
    const atoms = lines.slice(4, 4 + count).map((line) => ({
      element: line.slice(31, 34).trim(),
      point: [
        Number(line.slice(0, 10)),
        Number(line.slice(10, 20)),
        Number(line.slice(20, 30)),
      ] as Point3,
    }));
    return {
      lines,
      atoms,
      bonds: lines
        .slice(4 + count, 4 + count + bonds)
        .map((line) => line.slice(0, 9).trim())
        .join("|"),
    };
  };
  const a = parse(reference),
    b = parse(mobile);
  if (
    a.atoms.length !== b.atoms.length ||
    a.bonds !== b.bonds ||
    a.atoms.some((atom, i) => atom.element !== b.atoms[i].element)
  )
    throw new Error(
      "Small molecules require identical ordered atom elements and bond topology for an unambiguous comparison.",
    );
  const result = kabsch(
    a.atoms.map((a) => a.point),
    b.atoms.map((a) => a.point),
  );
  for (let i = 0; i < b.atoms.length; i++) {
    const point = result.transform(b.atoms[i].point);
    b.lines[4 + i] =
      point.map((v) => v.toFixed(4).padStart(10)).join("") +
      b.lines[4 + i].slice(30);
  }
  return {
    data: b.lines.join("\n"),
    rmsd: result.rmsd,
    count: b.atoms.length,
    method: "identical ordered MOL topology",
  };
}
