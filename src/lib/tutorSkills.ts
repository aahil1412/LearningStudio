import type { ContentBlock } from "../types";

/** Versioned, application-owned authoring rules. Selected for every tutor request,
 * not only while an IDE agent happens to have a design skill installed. */
export const visualAuthoringSkill = {
  id: "scientific-teaching",
  version: 4,
  rules: [
    "Plan the explanation around what the learner changes and observes. Use a concrete mechanism early, not a wall of prose followed by a decorative image. Introduce a short predict, manipulate, compare sequence; checkpoints remain optional.",
    "For transcription, central dogma and mutations that affect proteins use gene-expression-lab. The learner steps RNA polymerase along the template, edits DNA, and compares actual codons and translated amino-acid sequences. Do not claim folding, promoter binding or clinical mutation effects from this sequence model.",
    "For gradient descent use optimization-lab. A changed learning rate or draggable starting point must recompute the actual gradient trajectory and loss, including instability. The rotatable surface shows the same analytic loss as the contour view.",
    "For other quantitative topics use experiment with a validated data-only model: named parameters with units and bounds, safe arithmetic derived values, curves, simple scene primitives, optional timeline, causal explanation stages and explicit assumptions. Bind controls to visible geometry/readouts. Use existing plots/molecules/chemistry when those better fit the concept; never turn every subject into boxes and arrows.",
    "First choose the explanatory mechanism: change a parameter, follow a causal step, inspect a real structure, or compare states. A label lookup alone is a conceptual diagram, not a simulation.",
    "Use trusted field-explorer for calculated classical scalar waves/packets. Label it a classical analogy when teaching quantum fields; it does not calculate an electron, a QFT vacuum or scattering amplitudes.",
    "Use interaction-vertices for QED/QCD coupling diagrams: straight fermion lines, wavy photons, curly gluons; QCD permits elementary three/four gluon vertices, QED has no elementary three/four photon vertex. Do not replace these with connected molecule blobs.",
    "Use protein-aggregation for illustrative concentration/unfolded-fraction/attraction/condensate controls. Show compact and extended chains and multiple-chain clusters. Declare toy kinetics and do not imply a protein-specific prediction.",
    "A one-step diagram has no playback toolbar. Every simulation parameter changes a visible calculated state. Definitions/selection feedback must appear near the clicked object, not after a long response.",
    "For other subjects prefer validated calculated plots, an appropriate trusted process template, verified molecular structures or a readable semantic diagram. Do not reuse one arbitrary glyph for unrelated scientific entities. Never invent coordinates or executable code.",
  ],
};
export function tutorSkillInstructions() {
  return (
    "\nRUNTIME_AUTHORING_SKILL: " +
    JSON.stringify(visualAuthoringSkill) +
    '\nInteractive schemas: {type:"illustration",spec:{template:"gene-expression-lab",title,caption,gene:{codingDna:"ATGGCTTTTGAATAA",label:"Synthetic sequence"}}}; {type:"illustration",spec:{template:"optimization-lab",title,optimization:{landscape:"quadratic|ravine|himmelblau",learningRate:0.1,start:[3,2],iterations:60}}}. These trusted renderers support stepping, experiments, state restoration and offline interaction. Choose automatically for relevant learning goals, not only when explicitly asked to draw.\nFor a custom interactive experiment use {type:"illustration",spec:{template:"experiment",title,caption,experiment:{question,parameters:[{id:"mass",label:"Mass",unit:"kg",min:1,max:10,step:1,value:2}],derived:[{id:"force",label:"Weight",unit:"N",expression:"mass*9.81"}],plot:{domain:[1,10],xLabel:"Mass (kg)",yLabel:"Weight (N)",curves:[{id:"weight",label:"F=mg",expression:"x*9.81",tone:"cool"}]},assumptions:["Uniform gravitational acceleration g = 9.81 m/s²; ideal weight model."]}}}. Optional scene:{width:800,height:300,elements:[{id,kind:"circle|rect|line|arrow|text|spring|particles",label,detail,x:"arithmetic",y:"arithmetic",x2?,y2?,width?,height?,radius?,count?,tone:"cool|warm|violet|green|neutral",drag?:{parameterId,axis:"x|y",from:0,to:800}}]}. Coordinates are renderer geometry, never molecular coordinates. Optional time:{duration:6,step:0.1,unit:"s"}; expressions can use time. Optional stages:[{id,title,explanation,parameters:{mass:4},time:0,focusIds:[]}]. Derived formulas are ordered and may reference earlier derived values and controls. Plot expressions additionally use x. Arithmetic and allowlisted elementary functions only; no code, property access, assignments, scripts or remote assets. Controls must have a meaningful visible consequence and assumptions must be explicit.\n' +
    "\nTrusted illustration schemas: field-explorer optionally field:{mode:wave|packet,amplitude:0..2,wavelength:0.5..6,width:0.4..4,speed:0.1..2}; protein-aggregation optionally aggregation:{concentration:0.2..5,unfoldedFraction:0..1,attraction:0..2,partition:1..12,condensate:boolean}; interaction-vertices optionally interaction:{theory:qed|qcd,vertex:matter|three-boson|four-boson}. All are {type:illustration,spec:{template,title,caption,...}} blocks. Use only matter vertices for QED. Choose these where appropriate without requiring a request to draw a diagram."
  );
}
/** Read-time improvements preserve the original saved transcript/specification.
 * Only recognized conceptual scenes are upgraded; unrelated topics stay intact. */
export function chooseTeachingVisual(
  block: ContentBlock,
  request = "",
): ContentBlock {
  if (block.type !== "illustration" || block.spec.template !== "scene")
    return block;
  const authored = [
    block.spec.title,
    block.spec.caption,
    ...(block.spec.scene?.participants.map((p) => p.label) || []),
  ].join(" ");
  const hasDomain =
    /quantum|field|gluon|quark|QCD|QED|protein|aggregat|condensate|phase separation/i.test(
      authored,
    );
  const topic = hasDomain ? authored : authored + " " + request;
  if (
    /\b(?:Yang[ –-]?Mills|gluons?|quark[ –-]?gluon|QCD|QED|quantum electrodynamics|interaction vert(?:ex|ices))\b/i.test(
      topic,
    )
  ) {
    const theory = /\b(?:Yang[ –-]?Mills|gluons?|quarks?|QCD)\b/i.test(topic)
      ? "qcd"
      : "qed";
    return {
      type: "illustration",
      spec: {
        template: "interaction-vertices",
        title:
          theory === "qcd"
            ? "Quark and gluon interaction vertices"
            : "Electron and photon interaction vertex",
        interaction: {
          theory,
          vertex:
            theory === "qcd" && /self|with gluons|three|four|Yang/i.test(topic)
              ? "three-boson"
              : "matter",
        },
        caption:
          "Permitted elementary interaction vertices, shown schematically. These are not particle trajectories or a calculated scattering event.",
      },
    };
  }
  if (
    /\b(?:protein.{0,28}(?:aggregat|unfold)|aggregat.{0,28}protein|condensates?|liquid.{0,12}phase separation)\w*\b/i.test(
      topic,
    )
  )
    return {
      type: "illustration",
      spec: {
        template: "protein-aggregation",
        title: "Explore protein aggregation",
        aggregation: {
          condensate: /condensate|inside|phase separation/i.test(topic),
        },
        caption:
          "An illustrative kinetic model. Change the inputs and compare the visible chains and clusters; it is not a molecular dynamics calculation or a protein-specific prediction.",
      },
    };
  if (
    /\b(?:quantum fields?|electron field|scalar field|field excitations?|wave[ -]?packets?)\b|\bQFT\b/i.test(
      topic,
    )
  )
    return {
      type: "illustration",
      spec: {
        template: "field-explorer",
        title: "Field intuition: a classical wave-packet analogy",
        field: { mode: "packet" },
        caption:
          "This calculated classical scalar field illustrates variation over space. It does not simulate a quantum electron, an electromagnetic field or a quantum vacuum.",
      },
    };
  return block;
}
