# Verification for Learning Studio 2.4.0

The recorded release checks ran on Windows on October 28, 2026 (local time). [Machine-readable summary](verification/summary.json).

| Check                       | Recorded result                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration            | 443 passed, no failed or skipped cases in the enabled-network verification                                                                   |
| Electron/browser workflows  | 121 unique workflows with passing latest results; affected reruns are not additional workflows                                               |
| Packaged learning workflows | 6/6 passed against the actual Windows executable                                                                                             |
| Packaged broader smoke      | Passed SQLite/subject restart, checkpoints, highlights, planning recovery, zoom, bounded memory, PDF.js, OCR, Plotly, RDKit and offline HTML |
| Runtime integrity           | All 82 packaged runtime files matched the checked build                                                                                      |
| Static/build checks         | TypeScript, ESLint and production renderer/main/offline builds passed                                                                        |

Coverage includes a representative 1.1 library migration with a pre-migration backup, optional assessments, cross-chat memory, branching, diagram/plot/molecule state, highlights, curriculum/textbook import, error recovery, cancellation and SQLite shutdown. Public-resource cases use actual scientific services. Selected AI request tests use explicitly labeled controlled transports.

The redesign was inspected in light, dark, custom and compact layouts. Default navigation labels were measured at 13px and 7.86:1 light / 13.13:1 dark contrast. Native pointer testing at 860px confirmed Reading controls no longer overlap navigation and dismiss with Escape/outside click. Automated accessibility checks complement rather than replace manual review.

After repository cleanup, all 443 unit/integration checks passed again, along with type checking, linting, a production build, and the two affected Electron workflows. The retained installer still matched all 82 runtime files from that clean-source build. Essential recorded teaching data was moved into `tests/fixtures/`; test setup now creates its scratch directory on a fresh checkout.

## Limits of the evidence

- These are recorded results for the release, not a claim that every future environment or provider response is verified.
- Fresh live ChatGPT quality and latency were not remeasured for this UI release. The existing supported connection is retained.
- The local installer is unsigned. Release acceptance used the unpacked packaged executable. The later cleanup also installed the verified installer per user and checked the installed executable hash, without running a live AI request.
- Earlier failed captures, verbose logs and development history were archived privately during repository cleanup. The public repository keeps the current summary, runnable tests and curated screenshots.

## Reproduce

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Set `STUDIO_NETWORK_TESTS=1` to enable public-resource cases. They depend on external service availability. Desktop tests use isolated profiles. No real model account or paid inference is needed for the normal automated suite.

For a packaged build, run `scripts/verify-package.mjs` and `scripts/verify-integrity.mjs` with `STUDIO_RELEASE_DIR` set to its release directory. The redesigned Electron suite also accepts `STUDIO_TEST_EXECUTABLE` pointing to the exact packaged executable.
