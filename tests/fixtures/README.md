# Scientific fixtures

`v2-1crn.pdb` contains the real Crambin structure distributed by RCSB PDB as entry **1CRN**. It was downloaded from <https://files.rcsb.org/download/1CRN.pdb>; the entry and original experimental publication are linked at <https://www.rcsb.org/structure/1CRN>. Coordinates and connectivity have not been generated or modified for the test.

The standalone-export tests use these public scientific coordinates to verify molecular rendering with the network disabled. They do not model an authenticated account or any private learner history. The tiny raster fixture and the two-page PDF are authored by the tests themselves.

`planning-real-biology-2026-10-28.json` contains two recorded curriculum chunks from an authorized general beginner-biology teaching test. Offline replay checks curriculum granularity and answer-key behavior; it is not evidence of a fresh live request. No credentials or private learner history are included.

`biology-teaching.json` contains only the generic questions and teaching content needed by the biology rendering regression. Account metadata and verbose original run records are excluded.

`studio-23-factory-colors.json` retains old factory colors needed to test settings preservation during upgrades. Version numbers in fixture and regression-test names identify compatibility cases, not old application builds. Historical development logs are archived separately from the public source tree.
