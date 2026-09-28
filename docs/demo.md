# Demo mode — internals and verified transcript

Demo mode exists so the whole platform can be shown in minutes, **using the real
pipeline end-to-end**. Nothing in it is UI theater: every button calls the same
services user actions do, and every "blockchain fact" shown is read back from the
chain.

## What LOAD DEMO DATA actually does

`POST /api/demo/load` (ADMIN) runs ~14 real transactions through
`prepareUpload → registerServerSide` (the exact code path user registrations use):

| # | Artifact | Purpose in the story |
|---|---|---|
| 1–3 | **Flood Detection Dataset v1.0 → v1.1 → v1.2** (8 files each: images + labels.csv + README) | Merkle-root fingerprinting, version lineage via `updateArtifactVersion` |
| 4–5 | **FloodNet Model v1 → v2** (binary weights) | v1's parent is dataset v1.2 — a cross-type *derivation* edge |
| 6–8 | **flood-detector-api v1.0.0 → v1.1.0 → v1.1.1** (npm-style package) | v1.1.1 is deliberately anomalous: 8× size jump, published minutes after v1.1.0 — the AI target |
| 9 | **Sensor Calibration Dataset v1.0** | the integrity-violation target |
| 10 | **legacy-preprocessing-toolkit v0.9.0** | real `transferArtifactOwnership` to Hardhat account #1 |
| 11 | **deprecated-augmentation-scripts v0.1.0** | real on-chain `revokeArtifact` |

Then: stored-copy verifications for three artifacts (real verification events) and
an AI analysis for every artifact (population 11 ⇒ IsolationForest **ML mode**).
Demo files are generated from a seeded PRNG — deterministic, so the same content
hashes identically on every machine.

## SIMULATE INTEGRITY VIOLATION

Rewrites the stored bytes of `calibration.csv` inside the content-addressed store
(after backing up the original as `.orig`). The on-chain commitment is untouched —
which is the entire point. Requires local storage mode.

## RUN VERIFICATION DEMO

Re-hashes the **stored copies** of the intact dataset and the tamper target and
compares them against the chain: one ✓ INTEGRITY VERIFIED, one ✕ INTEGRITY
MISMATCH with registered vs current hashes and the manifest diff naming
`calibration.csv`.

## RESET DEMO

Restores tampered objects from backups, **deploys a fresh `ProofChainRegistry`**
(real deployment transaction — the old ledger stays on the dev chain because
immutability is not optional), updates `deployments/localhost.json`, clears the
database index. The indexer notices the new contract address and re-indexes from
its deploy block.

---

## Verified test transcript (2026-09-28, this machine)

Unit/integration suites:

| Suite | Result |
|---|---|
| `packages/crypto` (vitest) — SHA-256 vectors, Merkle determinism/tamper/proofs, manifests | **16/16 pass** |
| `blockchain` (Hardhat) — registry + certificate, incl. unauthorized ops & revocation | **30/30 pass** |
| `apps/api` (vitest) — upload path handling, error mapping | **10/10 pass** |
| `apps/ai-service` (pytest) — features, rules, baseline fallback, ML ordering, language policy | **11/11 pass** |
| `apps/web` (vitest + testing-library) — verification verdict rendering (pass/mismatch/unregistered) | **3/3 pass** |

Live end-to-end (`node scripts/e2e-check.mjs` against the running stack):

```
PASS  API health
PASS  chain reachable — network=localhost
PASS  registry deployed — 0x5FbDB2315678afecb367f032d93F642f64180aa3
PASS  admin login
PASS  prepare: fingerprint computed
PASS  prepare: merkle root for multi-file — 3 files
PASS  prepare: stored to storage layer — local
PASS  register: on-chain transaction confirmed — block=3
PASS  register: chain artifact id assigned — #1
PASS  register: gas recorded — gas=376039
PASS  artifact detail served
PASS  artifact files listed
PASS  verify identical: matched
PASS  verify identical: hash equals registered
PASS  verify identical: resolved artifact
PASS  verify tampered: mismatch detected
PASS  verify tampered: original identified via manifest
PASS  verify tampered: modified file named — {"modified":["labels.csv"]}
PASS  verify tampered: registered vs current hashes differ
PASS  ai: risk score returned — score=0.45 level=MEDIUM
PASS  ai: mode + model version stated
PASS  dashboard: real totals
PASS  explorer: real blocks listed
23 passed, 0 failed
```

Demo engine, exercised live: load (11 artifacts, transfer + revocation on-chain),
tamper, verification demo (intact ✓ / tampered ✕ with `calibration.csv` named),
AI on the anomalous release → `score=0.518 MEDIUM, mode=ML,
anomalies=SIZE_JUMP, RAPID_REVERSIONING, ML_OUTLIER`, and reset (fresh contract at
a new address, index cleared).
