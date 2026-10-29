import { describe, expect, it } from "vitest";
import {
  AMINO_NAMES,
  AMINO_ACID_NAMES,
  DEFAULT_CODING_DNA,
  GENETIC_CODE,
  anticodonFor,
  compareMutation,
  geneTimeline,
  mutateDna,
  normalizeDna,
  templateFromCoding,
  transcribeCodingDna,
  translateCodingDna,
  translationWindow,
  type GeneMutation,
} from "../src/lib/explainers/geneExpression";

describe("a sequence-grounded gene expression explainer", () => {
  it("matches all64 assignments of NCBI standard code1, including exactly3 stop codons", () => {
    const expected =
      "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
    const alphabet = "UCAG";
    let i = 0;
    for (const first of alphabet)
      for (const second of alphabet)
        for (const third of alphabet)
          expect(GENETIC_CODE[first + second + third]).toBe(expected[i++]);
    expect(Object.keys(GENETIC_CODE)).toHaveLength(64);
    expect(Object.values(GENETIC_CODE).filter((a) => a === "*")).toHaveLength(
      3,
    );
    expect(
      new Set(Object.values(GENETIC_CODE).filter((a) => a !== "*")).size,
    ).toBe(20);
    expect(AMINO_NAMES.M).toBe("Met");
    expect(AMINO_ACID_NAMES.M).toBe("methionine");
  });
  it("keeps displayed coding5′→3′, template3′→5′ and RNA5′→3′ sequences aligned", () => {
    expect(templateFromCoding("ATGGCTTAA")).toBe("TACCGAATT");
    expect(transcribeCodingDna("ATGGCTTAA")).toBe("AUGGCUUAA");
    expect(anticodonFor("AUG")).toBe("UAC");
    expect(anticodonFor("GCU")).toBe("CGA");
    expect(anticodonFor("UAA")).toBe("");
    expect(anticodonFor("UGA")).toBe("");
    expect(anticodonFor("UAG")).toBe("");
  });
  it("generates the synthetic reference chain from actual codons and ends at stop without a stop amino acid", () => {
    const model = translateCodingDna(DEFAULT_CODING_DNA);
    expect(model.rna).toBe("AUGGCUUUUGAAUAA");
    expect(model.peptide).toBe("MAFE");
    expect(model.startIndex).toBe(0);
    expect(model.stopIndex).toBe(12);
    expect(model.status).toBe("terminated");
    expect(model.codons.map((c) => c.rna)).toEqual([
      "AUG",
      "GCU",
      "UUU",
      "GAA",
      "UAA",
    ]);
    expect(geneTimeline(model)).toBe(20);
  });
  it("does not invent initiation, termination or incomplete amino acids", () => {
    expect(translateCodingDna("CGCGCC")).toMatchObject({
      peptide: "",
      status: "no-start",
      startIndex: -1,
      codons: [],
    });
    expect(translateCodingDna("ATGGCTG")).toMatchObject({
      peptide: "MA",
      status: "no-stop",
      stopIndex: null,
      trailingBases: 1,
    });
    expect(translateCodingDna("CCATGGCTTAA")).toMatchObject({
      peptide: "MA",
      startIndex: 2,
      stopIndex: 8,
    });
    expect(translateCodingDna("ATGTAAGCT").peptide).toBe("M");
  });
  it("marks omitted transcript bases without inventing RNA ends at the visible stop or codon window", () => {
    const mutation: GeneMutation = {
      kind: "insertion",
      position: 6,
      base: "C",
    };
    const edited = translateCodingDna(mutateDna(DEFAULT_CODING_DNA, mutation));
    expect(translationWindow(edited, 3)).toMatchObject({
      firstBase: 0,
      endBase: 12,
      hiddenBefore: false,
      hiddenAfter: true,
    });
    expect(edited.rna).toHaveLength(16);
    const long = translateCodingDna("CCATG" + "GCT".repeat(16) + "TAA" + "CCC");
    const middle = translationWindow(long, 8);
    expect(middle.codons).toHaveLength(5);
    expect(middle.hiddenBefore).toBe(true);
    expect(middle.hiddenAfter).toBe(true);
    expect(long.rna.slice(middle.firstBase, middle.endBase)).toBe(
      middle.codons.map((c) => c.rna).join(""),
    );
    expect(
      translationWindow(translateCodingDna(DEFAULT_CODING_DNA), 4),
    ).toMatchObject({
      hiddenBefore: false,
      hiddenAfter: false,
      firstBase: 0,
      endBase: 15,
    });
  });
  it.each([
    [{ kind: "substitution", position: 5, base: "C" }, "synonymous", "MAFE"],
    [{ kind: "substitution", position: 4, base: "T" }, "missense", "MVFE"],
    [{ kind: "substitution", position: 9, base: "T" }, "nonsense", "MAF"],
    [{ kind: "substitution", position: 12, base: "C" }, "stop-loss", "MAFEQ"],
    [
      { kind: "substitution", position: 14, base: "G" },
      "stop-retained",
      "MAFE",
    ],
    [{ kind: "insertion", position: 6, base: "C" }, "frameshift", "MAL"],
    [{ kind: "deletion", position: 6, base: "C" }, "frameshift", "MALN"],
    [{ kind: "deletion", position: 0, base: "C" }, "start-loss", ""],
    [
      { kind: "insertion", position: 0, base: "C" },
      "outside-coding-region",
      "MAFE",
    ],
  ] as [GeneMutation, string, string][])(
    "calculates real consequence of %j",
    (mutation, kind, peptide) => {
      const changed = mutateDna(DEFAULT_CODING_DNA, mutation);
      const comparison = compareMutation(DEFAULT_CODING_DNA, changed, mutation);
      expect(comparison.kind).toBe(kind);
      expect(comparison.edited.peptide).toBe(peptide);
      expect(comparison.original.peptide).toBe("MAFE");
      expect(comparison.explanation.length).toBeGreaterThan(30);
    },
  );
  it("retains a valid shifted start when an upstream base is deleted and does not label it frameshift", () => {
    const reference = "CC" + DEFAULT_CODING_DNA;
    const mutation: GeneMutation = { kind: "deletion", position: 0, base: "C" };
    expect(
      compareMutation(reference, mutateDna(reference, mutation), mutation),
    ).toMatchObject({
      kind: "outside-coding-region",
      edited: { startIndex: 1, peptide: "MAFE" },
    });
  });
  it("does not call nontranslated changed RNA synonymous, and identifies an introduced start", () => {
    expect(compareMutation("CCCGCC", "CCCGCT").kind).toBe("no-start");
    expect(compareMutation("ACGGCTTAA", "ATGGCTTAA").kind).toBe("start-gain");
    expect(compareMutation(DEFAULT_CODING_DNA, DEFAULT_CODING_DNA).kind).toBe(
      "unchanged",
    );
    expect(compareMutation(" atg gct taa ", "ATGGCTTAA").kind).toBe(
      "unchanged",
    );
    const reference = DEFAULT_CODING_DNA + "CCC",
      mutation: GeneMutation = {
        kind: "substitution",
        position: 15,
        base: "G",
      };
    expect(
      compareMutation(reference, mutateDna(reference, mutation), mutation).kind,
    ).toBe("outside-coding-region");
  });
  it("validates finite bounded DNA and edits rather than silently accepting arbitrary strings or invalid coordinates", () => {
    expect(normalizeDna("atg gct\n taa")).toBe("ATGGCTTAA");
    for (const dna of ["ATU", "NNN", "<script>", "AT", "A".repeat(181)])
      expect(() => normalizeDna(dna)).toThrow();
    for (const position of [-1, 1.2, NaN, Infinity, 16])
      expect(() =>
        mutateDna(DEFAULT_CODING_DNA, {
          kind: "substitution",
          position,
          base: "A",
        }),
      ).toThrow();
    expect(() =>
      mutateDna("ATG", { kind: "deletion", position: 0, base: "A" }),
    ).toThrow();
    expect(() =>
      mutateDna("A".repeat(180), { kind: "insertion", position: 0, base: "A" }),
    ).toThrow();
    expect(
      mutateDna("ATG", { kind: "insertion", position: 3, base: "A" }),
    ).toBe("ATGA");
    expect(() =>
      mutateDna(DEFAULT_CODING_DNA, {
        kind: "invalid",
        position: 0,
        base: "A",
      } as unknown as GeneMutation),
    ).toThrow();
  });
});
