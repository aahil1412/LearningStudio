# Implementation status: 2.4.0

The current application includes subject workspaces, shared SQLite memory, reviewable curricula, focused lesson sections, contextual tutoring, inline scientific renderers, knowledge graphs, notes/highlights, source-guided study, review, visual notebooks/canvas, textbooks, appearance customization and portable HTML exports.

Recorded release verification: **443 unit/integration checks**, **121 unique workflows with passing latest results**, **6/6 packaged learning workflows**, and **82 matching packaged runtime files**. See [verification scope](VERIFICATION.md) and [the current summary](verification/summary.json).

Repository cleanup preserved application code and required compatibility tests. All 443 unit/integration checks, type checking, linting, the production build and the two affected Electron workflows passed afterward. Test inputs formerly embedded in development reports now live in `tests/fixtures/`.

## Boundaries

- Fresh live ChatGPT response quality and latency were not remeasured for this UI release; controlled transports are labeled.
- Account/model eligibility and remote latency depend on the selected provider. Remaining subscription quota is not fabricated.
- The local installer is unsigned. Scientific models have stated assumptions; AI explanations and OCR require appropriate review.
- Local/compatible model connections can be configured, but no local model is installed or required.
- Historical logs and old builds are archived outside the public source tree. They are not application dependencies.

The source archive and installer do not contain a user's learning database or credentials. Upgrades preserve each installation's own library unless its owner explicitly chooses a backed-up fresh start.
