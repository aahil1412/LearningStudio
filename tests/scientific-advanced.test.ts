import { describe, it, expect } from "vitest";
import {
  differentiate,
  evaluateExpression,
  expressionString,
  parseExpression,
  simplify,
} from "../src/lib/science/expressions";
import {
  integrateOde,
  sampleExpressions,
  validateOde,
} from "../src/lib/science/numerics";
import {
  sampleSurface,
  sampleVectorField,
  scientificCurves,
} from "../src/lib/science/plots";
import {
  atomicAngle,
  atomicDistance,
  atomicTorsion,
  kabsch,
  parseResidueSelection,
  pdbTrajectory,
  type Point3,
} from "../src/lib/science/molecular";
import { validateContentBlock } from "../src/lib/visualSpecs";
describe("bounded mathematical AST", () => {
  it("implements precedence, scientific constants, parameters and right-associative powers", () => {
    expect(evaluateExpression(parseExpression("-2^2"), {})).toBe(-4);
    expect(evaluateExpression(parseExpression("2^3^2"), {})).toBe(512);
    expect(
      evaluateExpression(parseExpression("a*sin(pi/2)+1e-3", ["a"]), { a: 2 }),
    ).toBeCloseTo(2.001, 12);
  });
  it.each([
    "globalThis.process",
    "x.constructor",
    "constructor(1)",
    "import(1)",
    "eval(2)",
    "Function(2)",
    "x=3",
    "x;1",
    "[1,2]",
    "sin(x)()",
    "x[0]",
    "__proto__",
    "while(1)",
  ])("rejects executable or reflective input %s", (source) => {
    expect(() => parseExpression(source)).toThrow();
  });
  it("enforces expression depth and token budgets", () => {
    expect(() =>
      parseExpression("(".repeat(40) + "x" + ")".repeat(40)),
    ).toThrow();
    expect(() => parseExpression(Array(250).fill("x").join("+"))).toThrow();
  });
  it("derives products, powers, quotients and chain rules correctly", () => {
    const source = parseExpression("exp(-x^2)*sin(x)+x^3/(1+x^2)");
    const derivative = differentiate(source);
    for (const x of [-1.3, -0.2, 0.6, 2]) {
      const h = 1e-5,
        numeric =
          (evaluateExpression(source, { x: x + h }) -
            evaluateExpression(source, { x: x - h })) /
          (2 * h);
      expect(evaluateExpression(derivative, { x })).toBeCloseTo(numeric, 7);
    }
    expect(expressionString(differentiate(parseExpression("x^2")))).toContain(
      "2",
    );
    expect(
      evaluateExpression(simplify(parseExpression("0+x*1")), { x: 3 }),
    ).toBe(3);
  });
  it("preserves undefined evaluations as plot gaps and never joins a pole", () => {
    const result = sampleExpressions(
      ["1/x", "sqrt(x)"],
      ["x"],
      {},
      [-1, 1],
      101,
    );
    expect(result.values[0][50]).toBeNull();
    expect(result.values[1][0]).toBeNull();
  });
});
describe("scientific calculations beyond presets", () => {
  it("uses RK4 with demonstrated fourth-order convergence on exponential decay", () => {
    const base = {
      variables: ["q"],
      derivatives: ["-q"],
      initial: [1],
      duration: 2,
    };
    const coarse = integrateOde({ ...base, step: 0.2 }),
      fine = integrateOde({ ...base, step: 0.1 });
    const error = (result: ReturnType<typeof integrateOde>) =>
      Math.abs(result.states.at(-1)![0] - Math.exp(-2));
    expect(error(fine)).toBeLessThan(error(coarse) / 12);
    expect(fine.times.at(-1)).toBeCloseTo(2, 12);
  });
  it("integrates a coupled oscillator and rejects excessive or divergent computations", () => {
    const result = integrateOde(
      {
        variables: ["x", "v"],
        derivatives: ["v", "-k*x"],
        initial: [1, 0],
        duration: Math.PI * 2,
        step: 0.01,
      },
      { k: 1 },
    );
    expect(result.states.at(-1)![0]).toBeCloseTo(1, 7);
    expect(() =>
      validateOde({
        variables: ["x"],
        derivatives: ["x"],
        initial: [1],
        duration: 1000,
        step: 0.0001,
      }),
    ).toThrow();
    expect(() =>
      integrateOde({
        variables: ["x"],
        derivatives: ["x^3"],
        initial: [20],
        duration: 10,
        step: 0.1,
      }),
    ).toThrow(/diverged/);
  });
  it("calculates surface coordinates, vector components, parametric curves and derivatives", () => {
    const surface = sampleSurface(
      {
        kind: "surface",
        title: "Paraboloid",
        expressions: ["x^2+y^2"],
        domain: [-1, 1],
      },
      {},
      3,
    );
    expect(surface.positions.slice(0, 3)).toEqual([-1, -1, 2]);
    expect(surface.positions.slice(12, 15)).toEqual([0, 0, 0]);
    expect(surface.indices.length).toBe(24);
    const field = sampleVectorField(
      {
        kind: "vector",
        title: "Rotation",
        expressions: ["-y", "x", "0"],
        domain: [-1, 1],
      },
      {},
      3,
    );
    const arrow = field.find(
      (v) => v.origin[0] === 1 && v.origin[1] === 0 && v.origin[2] === 0,
    )!;
    expect(arrow.vector).toEqual([-0, 1, 0]);
    const curve = scientificCurves(
      {
        kind: "parametric",
        title: "Circle",
        expressions: ["cos(t)", "sin(t)"],
        domain: [0, 2 * Math.PI],
      },
      {},
    ).curves[0];
    expect(curve.x[0]).toBe(1);
    expect(curve.y.at(-1)).toBeCloseTo(0, 12);
  });
  it("validates model-authored new simulations and rejects code hidden in specifications", () => {
    expect(
      validateContentBlock({
        type: "plot",
        spec: {
          kind: "ode",
          title: "Reaction",
          parameters: { k: 0.3 },
          ode: {
            variables: ["c"],
            derivatives: ["-k*c"],
            initial: [1],
            duration: 10,
            step: 0.02,
          },
        },
      }),
    ).not.toBeNull();
    expect(
      validateContentBlock({
        type: "plot",
        spec: {
          kind: "surface",
          title: "Bad",
          expressions: ["window.alert(1)"],
        },
      }),
    ).toBeNull();
    expect(
      validateContentBlock({
        type: "chemical",
        input: "CCO",
        format: "smiles",
      }),
    ).not.toBeNull();
  });
});
describe("scientifically valid molecular geometry", () => {
  const reference: Point3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ];
  it("recovers an exact rigid rotation and translation without reflection", () => {
    const mobile = reference.map(
      ([x, y, z]) => [-y + 10, x - 4, z + 2] as Point3,
    );
    const result = kabsch(reference, mobile);
    expect(result.rmsd).toBeLessThan(1e-12);
    for (let i = 0; i < reference.length; i++)
      expect(atomicDistance(result.aligned[i], reference[i])).toBeLessThan(
        1e-12,
      );
  });
  it("does not mistake mirror chirality for a rigid alignment", () => {
    const mirror = reference.map(([x, y, z]) => [-x, y, z] as Point3);
    expect(kabsch(reference, mirror).rmsd).toBeGreaterThan(0.1);
    expect(() =>
      kabsch(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
        ],
      ),
    ).toThrow(/Collinear/);
  });
  it("measures distances, angles, signed torsions and geometric degeneracy", () => {
    expect(atomicDistance([0, 0, 0], [0, 3, 4])).toBe(5);
    expect(atomicAngle([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90);
    expect(
      Math.abs(atomicTorsion([1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 1])),
    ).toBeCloseTo(90);
    expect(() => atomicAngle([0, 0, 0], [0, 0, 0], [1, 0, 0])).toThrow();
  });
  it("translates only the controlled residue selection grammar", () => {
    expect(parseResidueSelection("chain:A resi:2-4 atom:CA")).toEqual({
      chain: "A",
      resi: [2, 3, 4],
      atom: "CA",
    });
    expect(() => parseResidueSelection("callback:eval")).toThrow();
    expect(() => parseResidueSelection("resi:1-99999")).toThrow();
  });
  it("rejects incompatible and incomplete trajectory topology", () => {
    const atom =
      "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 20.00           C  ";
    const frames = `MODEL        1\n${atom}\nENDMDL\nMODEL        2\n${atom}\nENDMDL`;
    expect(pdbTrajectory(frames)).toHaveLength(2);
    expect(() =>
      pdbTrajectory(
        frames.replace(
          "MODEL        2",
          "MODEL        2\nATOM      2  N   ALA A   1       2.000   3.000   4.000  1.00 20.00           N",
        ),
      ),
    ).toThrow(/identical/);
    expect(() => pdbTrajectory("MODEL        1\n" + atom)).toThrow(
      /incomplete/,
    );
  });
});
