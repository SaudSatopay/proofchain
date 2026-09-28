# AI component — anomaly / risk analysis

FastAPI service in [`apps/ai-service/`](../../apps/ai-service). Endpoints:
`GET /health`, `GET /model-info`, `POST /analyze`. Tests: `test_analyzer.py`
(11 pytest cases covering normal vs anomalous samples, baseline fallback, rule
triggers, and the honest-language guarantee).

## What it analyzes (real inputs only)

The API assembles each artifact's **actual registered history** — never synthetic
placeholders:

- type, size, file count, registration time;
- full version lineage (sizes + timestamps of every version);
- ownership transfers (from chain events);
- verification outcomes (passes/failures recorded by the verifier);
- revocation state.

## Feature vector (14 features)

`log_size_bytes, log_file_count, version_count, version_index,
max_size_jump_ratio, median_release_interval_hours, min_release_interval_hours,
ownership_transfers, verification_count, verification_failure_rate, revoked_flag,
is_dataset, is_model, is_software`

## Layer 1 — deterministic rule baseline (always computed)

Interpretable signals with fixed weights; each fires with a code, severity,
feature name and plain-language detail:

| Code | Trigger | Weight |
|---|---|---|
| `SIZE_JUMP` / `SIZE_DRIFT` | ≥4× / ≥2.5× size change between consecutive versions | 0.35 / 0.18 |
| `RAPID_REVERSIONING` | ≥3 versions with a release gap under 30 minutes | 0.15 |
| `INTEGRITY_FAILURES` | any failed verification vs the on-chain commitment | 0.25 + 0.4·failure_rate (cap 0.45) |
| `OWNERSHIP_TRANSFER` / `OWNERSHIP_CHURN` | 1 / ≥2 provenance transfers | 0.10 / 0.20 |
| `REVOKED` | owner revoked the artifact on-chain | 0.25 |

## Layer 2 — Isolation Forest (scikit-learn)

When the registered population has **≥ 10 artifacts**, an
`IsolationForest(n_estimators=200, contamination='auto', random_state=42)` is
fitted on the population's feature matrix. Isolation Forests isolate outliers with
fewer random splits; the target's `decision_function` value is mapped through a
sigmoid (`risk = 1/(1+e^{8·df})`) into 0..1. A negative `df` adds an `ML_OUTLIER`
signal.

**Final score** = `0.6 · rules + 0.4 · ml` (mode `ML`, model
`isolation-forest-v1`).

## Insufficient data — the honest fallback

With fewer than 10 registered artifacts the response is rule-only, mode
`BASELINE`, model `rule-baseline-v1`, and the first explanation line is literally:

> INSUFFICIENT HISTORICAL DATA — BASELINE ANALYSIS. Only N registered artifact(s)
> available; the Isolation Forest activates at 10.

Nothing is ever a random number; identical inputs produce identical outputs
(fixed `random_state`, deterministic rules).

## Risk levels

`LOW < 0.35 ≤ MEDIUM < 0.60 ≤ HIGH < 0.82 ≤ CRITICAL` — shared constants with the
frontend (`packages/shared`).

## Language policy (enforced by a test)

The analysis reports *statistical anomaly*, not verdicts. Phrasing used:
"Potential anomaly detected", "exhibits unusual behavior", "further investigation
recommended". The word "malicious" never appears in any output — asserted by
`test_language_never_claims_malice`. The division of labor is explicit in the UI:
**the blockchain proves integrity; the model only points at what deserves a
closer look.**

## Response shape

```json
{
  "riskScore": 0.518,
  "riskLevel": "MEDIUM",
  "anomalies": [
    {"code": "SIZE_JUMP", "severity": "HIGH", "feature": "max_size_jump_ratio",
     "detail": "Potential anomaly detected: artifact size changed by 7.7x between consecutive versions."}
  ],
  "explanation": ["…"],
  "modelVersion": "isolation-forest-v1",
  "mode": "ML",
  "sampleCount": 11,
  "featureCount": 14,
  "analyzedAt": "2026-09-28T12:49:59Z"
}
```

Every analysis is persisted (`ai_analysis` table) with the exact feature snapshot
it was computed from, so dashboards and artifact pages always show real, dated
results. If the service is down, the API returns `503 AI_UNAVAILABLE` and the UI
says the analysis is unavailable — it is never faked.
