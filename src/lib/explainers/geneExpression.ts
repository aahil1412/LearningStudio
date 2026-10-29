/** Standard genetic code (NCBI transl_table=1). This is sequence logic, not a
 * prediction of a real gene, expression level, folding, phenotype or disease. */
export const DEFAULT_CODING_DNA = "ATGGCTTTTGAATAA";
export const GENETIC_CODE: Readonly<Record<string, string>> = Object.freeze({
  UUU: "F",
  UUC: "F",
  UUA: "L",
  UUG: "L",
  UCU: "S",
  UCC: "S",
  UCA: "S",
  UCG: "S",
  UAU: "Y",
  UAC: "Y",
  UAA: "*",
  UAG: "*",
  UGU: "C",
  UGC: "C",
  UGA: "*",
  UGG: "W",
  CUU: "L",
  CUC: "L",
  CUA: "L",
  CUG: "L",
  CCU: "P",
  CCC: "P",
  CCA: "P",
  CCG: "P",
  CAU: "H",
  CAC: "H",
  CAA: "Q",
  CAG: "Q",
  CGU: "R",
  CGC: "R",
  CGA: "R",
  CGG: "R",
  AUU: "I",
  AUC: "I",
  AUA: "I",
  AUG: "M",
  ACU: "T",
  ACC: "T",
  ACA: "T",
  ACG: "T",
  AAU: "N",
  AAC: "N",
  AAA: "K",
  AAG: "K",
  AGU: "S",
  AGC: "S",
  AGA: "R",
  AGG: "R",
  GUU: "V",
  GUC: "V",
  GUA: "V",
  GUG: "V",
  GCU: "A",
  GCC: "A",
  GCA: "A",
  GCG: "A",
  GAU: "D",
  GAC: "D",
  GAA: "E",
  GAG: "E",
  GGU: "G",
  GGC: "G",
  GGA: "G",
  GGG: "G",
});
export const AMINO_NAMES: Readonly<Record<string, string>> = Object.freeze({
  A: "Ala",
  C: "Cys",
  D: "Asp",
  E: "Glu",
  F: "Phe",
  G: "Gly",
  H: "His",
  I: "Ile",
  K: "Lys",
  L: "Leu",
  M: "Met",
  N: "Asn",
  P: "Pro",
  Q: "Gln",
  R: "Arg",
  S: "Ser",
  T: "Thr",
  V: "Val",
  W: "Trp",
  Y: "Tyr",
  "*": "Stop",
});
export const AMINO_ACID_NAMES: Readonly<Record<string, string>> = Object.freeze(
  {
    A: "alanine",
    C: "cysteine",
    D: "aspartate",
    E: "glutamate",
    F: "phenylalanine",
    G: "glycine",
    H: "histidine",
    I: "isoleucine",
    K: "lysine",
    L: "leucine",
    M: "methionine",
    N: "asparagine",
    P: "proline",
    Q: "glutamine",
    R: "arginine",
    S: "serine",
    T: "threonine",
    V: "valine",
    W: "tryptophan",
    Y: "tyrosine",
  },
);
export type DnaBase = "A" | "C" | "G" | "T";
export type GeneMutation = {
  kind: "substitution" | "insertion" | "deletion";
  position: number;
  base: DnaBase;
};
export type Translation = {
  rna: string;
  peptide: string;
  startIndex: number;
  stopIndex: number | null;
  codons: { rna: string; amino: string; index: number }[];
  status: "no-start" | "terminated" | "no-stop";
  trailingBases: number;
};
export function normalizeDna(input: string): string {
  const value = input.replace(/\s/g, "").toUpperCase();
  if (!/^[ACGT]{3,180}$/.test(value))
    throw new Error("Use 3–180 DNA bases: A, C, G and T.");
  return value;
}
export function templateFromCoding(dna: string): string {
  const complement: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };
  return normalizeDna(dna)
    .split("")
    .map((base) => complement[base])
    .join("");
}
export function transcribeCodingDna(dna: string): string {
  return normalizeDna(dna).replaceAll("T", "U");
}
/** Anticodon displayed left to right as 3′→5′ opposite a 5′→3′ codon. */
export function anticodonFor(codon: string): string {
  if (!/^[ACGU]{3}$/.test(codon) || GENETIC_CODE[codon] === "*") return "";
  const pair: Record<string, string> = { A: "U", U: "A", C: "G", G: "C" };
  return codon
    .split("")
    .map((base) => pair[base])
    .join("");
}
export function translateCodingDna(dna: string): Translation {
  const rna = transcribeCodingDna(dna),
    startIndex = rna.indexOf("AUG");
  const codons: Translation["codons"] = [];
  let peptide = "",
    stopIndex: number | null = null;
  if (startIndex < 0)
    return {
      rna,
      peptide,
      startIndex,
      stopIndex,
      codons,
      status: "no-start",
      trailingBases: rna.length % 3,
    };
  for (let index = startIndex; index + 2 < rna.length; index += 3) {
    const triplet = rna.slice(index, index + 3),
      amino = GENETIC_CODE[triplet];
    codons.push({ rna: triplet, amino, index });
    if (amino === "*") {
      stopIndex = index;
      break;
    }
    peptide += amino;
  }
  return {
    rna,
    peptide,
    startIndex,
    stopIndex,
    codons,
    status: stopIndex === null ? "no-stop" : "terminated",
    trailingBases: stopIndex === null ? (rna.length - startIndex) % 3 : 0,
  };
}
export function mutateDna(input: string, mutation: GeneMutation): string {
  const dna = normalizeDna(input);
  const maximum = mutation.kind === "insertion" ? dna.length : dna.length - 1;
  if (
    !["substitution", "insertion", "deletion"].includes(mutation.kind) ||
    !Number.isInteger(mutation.position) ||
    mutation.position < 0 ||
    mutation.position > maximum ||
    typeof mutation.base !== "string" ||
    !"ACGT".includes(mutation.base) ||
    mutation.base.length !== 1
  )
    throw new Error("Choose a valid base and mutation position.");
  if (mutation.kind === "deletion" && dna.length === 3)
    throw new Error("Keep at least three bases in this teaching model.");
  if (mutation.kind === "insertion" && dna.length === 180)
    throw new Error("This teaching sequence supports up to 180 bases.");
  const at = mutation.position;
  return mutation.kind === "substitution"
    ? dna.slice(0, at) + mutation.base + dna.slice(at + 1)
    : mutation.kind === "insertion"
      ? dna.slice(0, at) + mutation.base + dna.slice(at)
      : dna.slice(0, at) + dna.slice(at + 1);
}
export function compareMutation(
  reference: string,
  changed: string,
  mutation?: GeneMutation,
): {
  kind:
    | "unchanged"
    | "synonymous"
    | "missense"
    | "nonsense"
    | "frameshift"
    | "start-loss"
    | "start-gain"
    | "no-start"
    | "stop-loss"
    | "stop-retained"
    | "outside-coding-region";
  title: string;
  explanation: string;
  original: Translation;
  edited: Translation;
} {
  reference = normalizeDna(reference);
  changed = normalizeDna(changed);
  const original = translateCodingDna(reference),
    edited = translateCodingDna(changed);
  const result = (
    kind: ReturnType<typeof compareMutation>["kind"],
    title: string,
    explanation: string,
  ) => ({ kind, title, explanation, original, edited });
  if (reference === changed)
    return result(
      "unchanged",
      "Original sequence",
      "Change one DNA base and watch its RNA codon and amino acid respond.",
    );
  if (original.startIndex < 0)
    return edited.startIndex < 0
      ? result(
          "no-start",
          "No AUG in either sequence",
          "The RNA changed, but neither sequence has the AUG required by this teaching model. No amino-acid chain is produced; calling this synonymous would be misleading.",
        )
      : result(
          "start-gain",
          "A start codon appeared",
          "The edited sequence now contains AUG, so this simplified first-AUG model can begin translation. A real cell also needs an appropriate initiation context.",
        );
  const expectedStart =
    original.startIndex +
    (mutation?.kind === "insertion" && mutation.position <= original.startIndex
      ? 1
      : mutation?.kind === "deletion" && mutation.position < original.startIndex
        ? -1
        : 0);
  if (
    changed.slice(expectedStart, expectedStart + 3) !== "ATG" ||
    edited.startIndex !== expectedStart
  )
    return result(
      "start-loss",
      "Original start choice changed",
      "The original AUG is missing or no longer the first AUG. This simplified model uses the first remaining AUG, if present; real initiation depends on surrounding signals.",
    );
  const codingEnd =
    original.stopIndex === null ? reference.length : original.stopIndex + 3;
  if (
    mutation &&
    (mutation.position < original.startIndex ||
      (mutation.kind === "insertion" &&
        mutation.position === original.startIndex) ||
      mutation.position >= codingEnd)
  )
    return result(
      "outside-coding-region",
      "Outside the modeled coding region",
      "This edit lies outside the original start-to-stop region. The model does not predict changes to regulation or RNA stability.",
    );
  if (mutation && mutation.kind !== "substitution" && original.startIndex >= 0)
    return result(
      "frameshift",
      "Reading frame shifted",
      "Adding or removing one base changes how downstream bases form triplets. New codons can change amino acids or introduce a stop. The model does not predict protein function.",
    );
  if (
    original.stopIndex !== null &&
    edited.stopIndex === original.stopIndex &&
    original.peptide === edited.peptide &&
    original.codons.at(-1)?.rna !== edited.codons.at(-1)?.rna
  )
    return result(
      "stop-retained",
      "Stop signal retained",
      "The original stop codon changed into another stop codon. Neither encodes an amino acid, and the calculated chain remains the same.",
    );
  if (original.peptide === edited.peptide && original.status === edited.status)
    return result(
      "synonymous",
      "Same amino-acid sequence",
      "The RNA codon changed but encodes the same amino acid in the standard code. This does not rule out effects on RNA processing, stability or expression in a real cell.",
    );
  if (
    edited.stopIndex !== null &&
    (original.stopIndex === null || edited.stopIndex < original.stopIndex)
  )
    return result(
      "nonsense",
      "An earlier stop",
      "A changed codon now signals stop earlier. Stop is recognized by a release factor, not a tRNA carrying a stop amino acid.",
    );
  if (
    original.stopIndex !== null &&
    (edited.stopIndex === null || edited.stopIndex > original.stopIndex)
  )
    return result(
      "stop-loss",
      "Original stop signal lost",
      "The original stop codon now encodes an amino acid. Translation continues to another in-frame stop or the end of this displayed sequence.",
    );
  return result(
    "missense",
    "Amino-acid sequence changed",
    "At least one codon encodes a different amino acid. A sequence change alone does not tell you the resulting protein structure, function or clinical effect.",
  );
}
export function geneTimeline(translation: Translation): number {
  return translation.rna.length + translation.codons.length;
}

/** A displayed codon window is a fragment, not a new RNA molecule. */
export function translationWindow(translation: Translation, activeIndex = 0) {
  const active = Math.max(
    0,
    Math.min(
      translation.codons.length - 1,
      Number.isFinite(activeIndex) ? Math.floor(activeIndex) : 0,
    ),
  );
  const codonStart = Math.max(
    0,
    Math.min(active - 2, translation.codons.length - 5),
  );
  const codons = translation.codons.slice(codonStart, codonStart + 5);
  const firstBase = codons[0]?.index ?? 0;
  const endBase = codons.length
    ? codons.at(-1)!.index + 3
    : Math.min(18, translation.rna.length);
  return {
    codonStart,
    codons,
    firstBase,
    endBase,
    hiddenBefore: firstBase > 0,
    hiddenAfter: endBase < translation.rna.length,
  };
}
