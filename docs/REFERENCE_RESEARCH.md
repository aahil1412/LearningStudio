# Reference research

The original implementation investigated [LearnHarness](https://github.com/amosblomqvist/learnharness) using direct source inspection and the supported standalone [REA](https://github.com/morluto/rea) toolkit. The reference was kept separate from the application and treated as AGPL-licensed material.

Useful patterns included persistent learning sessions, structured lesson state, prerequisite relationships and typed visual content. Weaknesses motivating the independent implementation included rigid teaching gates, opaque background work, fragile recovery, diagram/text collisions, confusion between coverage and understanding, and insufficient theme control.

Learning Studio uses original code and prompts. It keeps assessments optional, retrieves structured subject memory from SQLite, records learning evidence separately from mentions, validates figure specifications, and preserves partial work after failures. Figures use trusted local renderers and real scientific structures rather than unrestricted model-generated programs.

The interface redesign used the [Impeccable](https://github.com/pbakaus/impeccable) design guidance, plus research into subject pathways, focused reading and interactive teaching. The result uses actual learning sections and experiments with on-demand tutor questions; the original conversation remains available as a secondary record.

Full historical investigation logs and superseded design reports are retained in the developer's private archive. They are not required to run, build or contribute to the application and are not shipped as runtime dependencies.
