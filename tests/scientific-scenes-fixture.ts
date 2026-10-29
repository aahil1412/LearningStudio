import type { IllustrationSpec } from "../src/types";

/** Authored specifications exercise the production grammar and renderer. They
 * are test examples, not claimed model responses or measured reaction data. */
export const scientificScenes: Record<string, IllustrationSpec> = {
  photosynthesis: {
    template: "scene",
    title: "Photosynthesis: coupled processes in a chloroplast",
    scene: {
      participants: [
        {
          id: "light",
          label: "Light energy",
          shape: "source",
          description:
            "Photons supply energy to light reactions. Light is not converted directly into carbon atoms.",
        },
        {
          id: "chloroplast",
          label: "Chloroplast pathways",
          shape: "compartment",
          description:
            "A functional compartment symbol. Light reactions and carbon fixation occur in different chloroplast regions and are coupled by chemical intermediates; internal structures are omitted.",
        },
        {
          id: "inputs",
          label: "Carbon dioxide and water",
          shape: "particle",
          description:
            "Carbon dioxide supplies the carbon fixed into carbohydrates. Water is the source of the oxygen released by light reactions. These symbols do not depict chemical bonds.",
        },
        {
          id: "outputs",
          label: "Carbohydrate precursors and oxygen",
          shape: "particle",
          description:
            "Coupled pathways yield carbohydrate precursors and release oxygen. This overview is not an elementary reaction or a quantitative stoichiometric model.",
        },
      ],
      relations: [
        {
          from: "light",
          to: "chloroplast",
          label: "Light reactions capture energy in chemical intermediates.",
          kind: "regulation",
        },
        {
          from: "inputs",
          to: "chloroplast",
          label:
            "Water feeds light reactions; carbon dioxide is fixed using their products.",
          kind: "movement",
        },
        {
          from: "chloroplast",
          to: "outputs",
          label:
            "Coupled pathways yield carbohydrate precursors and release oxygen from water.",
          kind: "conversion",
        },
      ],
      steps: [
        {
          id: "capture",
          label: "Capture energy",
          description:
            "Light reactions supply chemical intermediates. The chloroplast symbol summarizes several internal structures.",
          activeIds: ["light", "chloroplast"],
        },
        {
          id: "inputs",
          label: "Use different inputs",
          description:
            "Water supplies electrons to light reactions; carbon dioxide supplies carbon to fixation reactions.",
          activeIds: ["inputs", "chloroplast"],
        },
        {
          id: "output",
          label: "Follow the products",
          description:
            "Carbon enters carbohydrate precursors. Released oxygen comes from water, rather than carbon dioxide.",
          activeIds: ["chloroplast", "outputs"],
        },
      ],
    },
  },
  enzyme: {
    template: "scene",
    title: "Enzyme catalysis: binding, conversion and catalyst release",
    scene: {
      participants: [
        {
          id: "enzyme",
          label: "Free enzyme",
          shape: "protein",
          description:
            "A catalyst that can be reused after a catalytic cycle. The protein symbol is not a predicted fold.",
        },
        {
          id: "substrate",
          label: "Substrate",
          shape: "particle",
          description:
            "Material acted on by the enzyme. No molecular connectivity is specified by this symbol.",
        },
        {
          id: "complex",
          label: "Enzyme–substrate complex",
          shape: "complex",
          description:
            "A bound functional state. Binding alone does not mean that conversion has already happened.",
        },
        {
          id: "products",
          label: "Released products",
          shape: "particle",
          description:
            "Products after the catalytic step and release. This conceptual sequence does not specify reaction rate or energy barriers.",
        },
      ],
      relations: [
        {
          from: "enzyme",
          to: "complex",
          label:
            "The enzyme binds the substrate; the bound state can also dissociate.",
          kind: "binding",
        },
        {
          from: "substrate",
          to: "complex",
          label:
            "The substrate enters the bound complex; binding is reversible.",
          kind: "binding",
        },
        {
          from: "complex",
          to: "products",
          label: "A catalytic step followed by release yields products.",
          kind: "conversion",
        },
        {
          from: "complex",
          to: "enzyme",
          label:
            "The catalyst is released for reuse; it is not consumed by the overall cycle.",
          kind: "movement",
        },
      ],
      steps: [
        {
          id: "bind",
          label: "Bind",
          description:
            "Enzyme and substrate form a reversible complex. The two arrows identify inputs to the same bound state, not two separate complexes.",
          activeIds: ["enzyme", "substrate", "complex"],
        },
        {
          id: "convert",
          label: "Convert and release",
          description:
            "The reaction produces material that can leave the enzyme. Rates and mechanisms depend on the particular enzyme.",
          activeIds: ["complex", "products"],
        },
        {
          id: "reuse",
          label: "Reuse the catalyst",
          description:
            "Free enzyme is available for another cycle. Catalysis does not consume the enzyme.",
          activeIds: ["complex", "enzyme"],
        },
      ],
    },
  },
  "gene-expression": {
    template: "scene",
    title: "Protein-coding gene expression: information and material",
    scene: {
      participants: [
        {
          id: "dna",
          label: "DNA template",
          shape: "dna",
          description:
            "A protein-coding gene can be transcribed. DNA is retained; it is not consumed or physically changed into RNA by the arrow.",
        },
        {
          id: "rna",
          label: "Messenger RNA",
          shape: "rna",
          description:
            "An RNA transcript carries coding information. Processing details and differences among organisms are omitted here.",
        },
        {
          id: "protein",
          label: "Polypeptide product",
          shape: "protein",
          description:
            "Amino acids are assembled using the RNA sequence. RNA is read, not converted into amino-acid material. Folding and modification can follow.",
        },
      ],
      relations: [
        {
          from: "dna",
          to: "rna",
          label:
            "Transcription copies sequence information into a new RNA molecule; DNA remains.",
          kind: "regulation",
        },
        {
          from: "rna",
          to: "protein",
          label:
            "Translation reads RNA information to assemble amino acids; RNA is not protein material.",
          kind: "regulation",
        },
      ],
      steps: [
        {
          id: "transcribe",
          label: "Transcribe a protein-coding gene",
          description:
            "The DNA sequence guides synthesis of a separate RNA strand. This is an information relationship, not a DNA-to-RNA material conversion.",
          activeIds: ["dna", "rna"],
        },
        {
          id: "translate",
          label: "Translate the message",
          description:
            "A ribosome reads messenger RNA to assemble amino acids. Some genes produce functional RNAs rather than proteins.",
          activeIds: ["rna", "protein"],
        },
      ],
    },
  },
};
