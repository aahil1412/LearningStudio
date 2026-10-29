import type { IllustrationSpec } from "../../types";

/** Original data-only examples. Sources/assumptions accompany the lesson. */
export const circuitExperiment: IllustrationSpec = {
  template: "experiment",
  title: "Change voltage and watch an ideal resistor respond",
  caption:
    "Ideal ohmic resistor at constant resistance and temperature. The moving marks represent conventional current, not electron speeds.",
  experiment: {
    question:
      "If you double voltage while resistance stays fixed, what happens to current?",
    parameters: [
      {
        id: "voltage",
        label: "Voltage",
        unit: "V",
        min: 0,
        max: 12,
        step: 0.5,
        value: 6,
      },
      {
        id: "resistance",
        label: "Resistance",
        unit: "Ω",
        min: 1,
        max: 20,
        step: 1,
        value: 6,
      },
    ],
    derived: [
      {
        id: "current",
        label: "Current",
        expression: "voltage/resistance",
        unit: "A",
      },
      {
        id: "power",
        label: "Power",
        expression: "voltage^2/resistance",
        unit: "W",
      },
    ],
    scene: {
      width: 800,
      height: 250,
      elements: [
        {
          id: "wireIn",
          kind: "arrow",
          label: "Conventional current into resistor",
          detail:
            "The ideal steady circuit has the same current on both sides of the resistor.",
          x: "60",
          y: "110",
          x2: "300",
          y2: "110",
          tone: "cool",
        },
        {
          id: "resistor",
          kind: "spring",
          label: "Fixed resistor",
          detail:
            "Resistance relates voltage to current through V = I R. This ideal example omits heating-induced resistance changes.",
          x: "300",
          y: "110",
          x2: "520",
          y2: "110",
          tone: "warm",
        },
        {
          id: "wireOut",
          kind: "arrow",
          label: "Conventional current out",
          x: "520",
          y: "110",
          x2: "740",
          y2: "110",
          tone: "cool",
        },
        {
          id: "carriers",
          kind: "particles",
          label: "Current indicator",
          detail:
            "More marks mean larger calculated current. Their schematic motion is not a physical drift-velocity calculation.",
          x: "70+30*time",
          y: "165",
          x2: "730",
          y2: "165",
          count: "min(20,2*current)",
          radius: "6",
          tone: "cool",
        },
      ],
    },
    plot: {
      domain: [0, 12],
      range: [0, 13],
      xLabel: "Voltage (V)",
      yLabel: "Current (A)",
      curves: [
        {
          id: "ohmic",
          label: "I = V / R",
          expression: "x/resistance",
          tone: "cool",
        },
      ],
    },
    time: { duration: 6, step: 0.1, unit: "illustrative time" },
    stages: [
      {
        id: "compareVoltage",
        title: "Change the push",
        explanation:
          "Keep resistance at 6 Ω. Move Voltage from 6 V to 12 V: current doubles from 1 A to 2 A.",
        parameters: { voltage: 6, resistance: 6 },
        focusIds: ["carriers", "resistor"],
      },
      {
        id: "compareResistance",
        title: "Change the resistance",
        explanation:
          "Keep voltage at 12 V and increase resistance. The current falls because I = V / R.",
        parameters: { voltage: 12, resistance: 12 },
        focusIds: ["resistor"],
      },
      {
        id: "comparePower",
        title: "Compare power",
        explanation:
          "At fixed resistance, doubling voltage quadruples power. Compare the live current and power readouts.",
        parameters: { voltage: 6, resistance: 6 },
        focusIds: ["carriers"],
      },
    ],
    assumptions: [
      "Steady ideal ohmic circuit; resistance is positive and constant at each setting.",
      "The current curve is calculated with I = V/R; power is P = V²/R.",
      "Schematic carrier marks are not measured electron positions or drift velocities.",
    ],
  },
};

export const equilibriumExperiment: IllustrationSpec = {
  template: "experiment",
  title: "Move a reversible reaction toward equilibrium",
  caption:
    "Illustrative ideal A ⇌ B system with fixed total concentration. K is specified, not predicted from molecular structure.",
  experiment: {
    question:
      "How does the equilibrium split change when the equilibrium constant changes?",
    parameters: [
      {
        id: "total",
        label: "Total concentration",
        unit: "mol/L",
        min: 0.1,
        max: 5,
        step: 0.1,
        value: 2,
      },
      {
        id: "ratio",
        label: "Equilibrium constant K",
        unit: "dimensionless",
        min: 0.1,
        max: 10,
        step: 0.1,
        value: 1,
      },
    ],
    derived: [
      {
        id: "reactant",
        label: "A at equilibrium",
        expression: "total/(1+ratio)",
        unit: "mol/L",
      },
      {
        id: "product",
        label: "B at equilibrium",
        expression: "total*ratio/(1+ratio)",
        unit: "mol/L",
      },
    ],
    scene: {
      width: 800,
      height: 300,
      elements: [
        {
          id: "reactantBar",
          kind: "rect",
          label: "A at equilibrium",
          detail: "[A] = total / (1 + K).",
          x: "120",
          y: "250-180*reactant/5",
          width: "180",
          height: "180*reactant/5",
          tone: "cool",
        },
        {
          id: "productBar",
          kind: "rect",
          label: "B at equilibrium",
          detail: "[B] = total K / (1 + K).",
          x: "500",
          y: "250-180*product/5",
          width: "180",
          height: "180*product/5",
          tone: "warm",
        },
        {
          id: "reaction",
          kind: "arrow",
          label: "A can convert to B",
          detail:
            "The opposing arrows indicate a reversible A ⇌ B system. This calculation shows equilibrium composition, not reaction rates.",
          x: "340",
          y: "130",
          x2: "460",
          y2: "130",
          tone: "neutral",
        },
        {
          id: "reverseReaction",
          kind: "arrow",
          label: "B can convert back to A",
          detail:
            "At equilibrium, opposing reaction rates are equal. The arrows do not encode their magnitude.",
          x: "460",
          y: "150",
          x2: "340",
          y2: "150",
          tone: "neutral",
        },
      ],
    },
    plot: {
      domain: [0.1, 10],
      range: [0, 5],
      xLabel: "Equilibrium constant K (dimensionless)",
      yLabel: "Concentration (mol/L)",
      curves: [
        {
          id: "a",
          label: "[A] at equilibrium",
          expression: "total/(1+x)",
          tone: "cool",
        },
        {
          id: "b",
          label: "[B] at equilibrium",
          expression: "total*x/(1+x)",
          tone: "warm",
        },
      ],
    },
    assumptions: [
      "Ideal single-step A ⇌ B reaction with 1:1 stoichiometry, conserved total concentration and unit standard-concentration convention.",
      "This is an equilibrium composition calculation, not a time-dependent kinetic simulation.",
      "The supplied K is a control. No temperature dependence or specific chemical identity is inferred.",
    ],
  },
};
