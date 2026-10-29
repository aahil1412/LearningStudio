# Contributing

Use Windows PowerShell and Node.js 24 LTS. Install dependencies with `npm ci`; run `npm run dev:desktop` for the actual desktop app. The renderer-only preview does not provide desktop services.

Before submitting a change, run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Tests use isolated temporary profiles. Public-service tests require `STUDIO_NETWORK_TESTS=1`; controlled provider fixtures must remain explicitly labeled. Do not use a real account or incur model usage without authorization.

Preserve these contracts:

- Back up existing libraries before additive SQLite migrations. Never reset a database silently.
- Keep subjects, conversations, curriculum, concepts, evidence and visual artifacts distinct.
- Do not infer mastery from a mention, page visit or completed explanation.
- Keep original transcripts and user edits intact. AI-proposed substantive updates remain reviewable and reversible.
- Preserve interactive state through navigation, fullscreen and restart.
- Render validated data specifications, never unrestricted model-generated JavaScript or HTML.
- Retain keyboard access, readable labels, custom themes and attribution.
- Never include private histories, credentials, user documents or account tokens in commits, logs or test fixtures.

Keep changes focused, explain how behavior changes, and report tests actually run. Use actual Electron acceptance tests for desktop workflows; a mock component alone does not verify the application.
