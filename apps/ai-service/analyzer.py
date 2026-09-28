"""
ProofChain anomaly analysis.

Two honest layers, combined:

1. Deterministic rule baseline — interpretable heuristics over an
   artifact's real history (size jumps between versions, rapid
   re-releases, failed integrity verifications, ownership churn,
   revocation). Always computed, and the ONLY layer when there is not
   enough historical data to fit a model — in that case the response is
   explicitly labeled "INSUFFICIENT HISTORICAL DATA — BASELINE ANALYSIS".

2. Isolation Forest (scikit-learn) — an unsupervised outlier model fitted
   on the feature vectors of the whole registered population (>= MIN_SAMPLES
   artifacts). Isolation Forests isolate anomalies with fewer random
   splits than normal points; the decision_function is mapped through a
   sigmoid into a 0..1 outlier risk.

The final riskScore is a weighted blend. IMPORTANT: this module reports
*potential anomalies* — statistical irregularity, never proof of malice.
Integrity itself is proven (or broken) by the blockchain hash commitment,
not by this model.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest

MIN_SAMPLES_FOR_ML = 10
RULE_WEIGHT = 0.6
ML_WEIGHT = 0.4

MODEL_VERSION_ML = "isolation-forest-v1"
MODEL_VERSION_BASELINE = "rule-baseline-v1"

FEATURE_NAMES = [
    "log_size_bytes",
    "log_file_count",
    "version_count",
    "version_index",
    "max_size_jump_ratio",
    "median_release_interval_hours",
    "min_release_interval_hours",
    "ownership_transfers",
    "verification_count",
    "verification_failure_rate",
    "revoked_flag",
    "is_dataset",
    "is_model",
    "is_software",
]

RISK_THRESHOLDS = {"MEDIUM": 0.35, "HIGH": 0.60, "CRITICAL": 0.82}


def risk_level(score: float) -> str:
    if score >= RISK_THRESHOLDS["CRITICAL"]:
        return "CRITICAL"
    if score >= RISK_THRESHOLDS["HIGH"]:
        return "HIGH"
    if score >= RISK_THRESHOLDS["MEDIUM"]:
        return "MEDIUM"
    return "LOW"


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


@dataclass
class Features:
    vector: list[float]
    max_size_jump: float
    median_interval_hours: float | None
    min_interval_hours: float | None
    failure_rate: float
    extras: dict[str, Any] = field(default_factory=dict)


def extract_features(record: dict[str, Any]) -> Features:
    """Map one artifact record (with lineage summary) onto the feature vector."""
    size = max(0, int(record.get("sizeBytes") or 0))
    files = max(1, int(record.get("fileCount") or 1))
    lineage = record.get("lineage") or []
    version_count = max(1, int(record.get("versionCount") or len(lineage) or 1))
    version_index = int(record.get("versionIndex") or 0)
    transfers = int(record.get("ownershipTransfers") or 0)
    verif_count = int(record.get("verificationCount") or 0)
    verif_failures = int(record.get("verificationFailures") or 0)
    revoked = 0.0 if record.get("active", True) else 1.0
    artifact_type = str(record.get("artifactType") or "").upper()

    # Size jump: the largest ratio between consecutive versions in the lineage.
    max_jump = 1.0
    sizes = [max(1, int(v.get("sizeBytes") or 1)) for v in lineage]
    for prev, cur in zip(sizes, sizes[1:]):
        ratio = max(cur / prev, prev / cur)
        max_jump = max(max_jump, ratio)

    # Release cadence over the lineage timestamps.
    intervals_h: list[float] = []
    stamps = []
    for v in lineage:
        try:
            stamps.append(_parse_ts(str(v.get("registeredAt"))))
        except (ValueError, TypeError):
            pass
    stamps.sort()
    for prev, cur in zip(stamps, stamps[1:]):
        intervals_h.append(max(0.0, (cur - prev).total_seconds() / 3600.0))
    median_interval = float(np.median(intervals_h)) if intervals_h else None
    min_interval = float(min(intervals_h)) if intervals_h else None

    failure_rate = verif_failures / verif_count if verif_count > 0 else 0.0

    vector = [
        math.log10(size + 1),
        math.log10(files + 1),
        float(version_count),
        float(version_index),
        min(max_jump, 50.0),
        median_interval if median_interval is not None else 24.0,
        min_interval if min_interval is not None else 24.0,
        float(transfers),
        float(verif_count),
        failure_rate,
        revoked,
        1.0 if artifact_type == "DATASET" else 0.0,
        1.0 if artifact_type == "MODEL" else 0.0,
        1.0 if artifact_type == "SOFTWARE" else 0.0,
    ]
    return Features(
        vector=vector,
        max_size_jump=max_jump,
        median_interval_hours=median_interval,
        min_interval_hours=min_interval,
        failure_rate=failure_rate,
    )


def rule_analysis(record: dict[str, Any], feats: Features) -> tuple[float, list[dict], list[str]]:
    """Deterministic baseline: interpretable signals with fixed weights."""
    anomalies: list[dict] = []
    explanation: list[str] = []
    score = 0.0

    if feats.max_size_jump >= 4.0:
        score += 0.35
        anomalies.append({
            "code": "SIZE_JUMP",
            "severity": "HIGH",
            "feature": "max_size_jump_ratio",
            "detail": f"Potential anomaly detected: artifact size changed by {feats.max_size_jump:.1f}x between consecutive versions.",
        })
        explanation.append(
            f"A {feats.max_size_jump:.1f}x size change between consecutive versions is unusual for this artifact class; further investigation recommended."
        )
    elif feats.max_size_jump >= 2.5:
        score += 0.18
        anomalies.append({
            "code": "SIZE_DRIFT",
            "severity": "MEDIUM",
            "feature": "max_size_jump_ratio",
            "detail": f"Size changed by {feats.max_size_jump:.1f}x between versions — above the typical drift range.",
        })
        explanation.append(
            f"Version-to-version size drift of {feats.max_size_jump:.1f}x exceeds the typical range; review the change log for this release."
        )

    version_count = int(record.get("versionCount") or 1)
    if version_count >= 3 and feats.min_interval_hours is not None and feats.min_interval_hours < 0.5:
        score += 0.15
        anomalies.append({
            "code": "RAPID_REVERSIONING",
            "severity": "MEDIUM",
            "feature": "min_release_interval_hours",
            "detail": f"{version_count} versions; shortest gap between releases was {feats.min_interval_hours * 60:.0f} minutes.",
        })
        explanation.append(
            "Multiple versions were published in rapid succession — a pattern seen both in hotfix bursts and in takeover attempts; correlate with the maintainer's release process."
        )

    if feats.failure_rate > 0:
        contrib = min(0.45, 0.25 + 0.4 * feats.failure_rate)
        score += contrib
        anomalies.append({
            "code": "INTEGRITY_FAILURES",
            "severity": "CRITICAL" if feats.failure_rate >= 0.5 else "HIGH",
            "feature": "verification_failure_rate",
            "detail": f"{feats.failure_rate:.0%} of recorded verifications did not match the on-chain fingerprint.",
        })
        explanation.append(
            "One or more integrity verifications failed against the blockchain commitment. The distributed copies of this artifact exhibit unusual behavior and should not be trusted until re-verified from a known-good source."
        )

    transfers = int(record.get("ownershipTransfers") or 0)
    if transfers >= 2:
        score += 0.2
        anomalies.append({
            "code": "OWNERSHIP_CHURN",
            "severity": "MEDIUM",
            "feature": "ownership_transfers",
            "detail": f"Provenance ownership changed {transfers} times.",
        })
        explanation.append(
            "Repeated ownership transfers detected — verify that each transfer corresponds to a legitimate handover."
        )
    elif transfers == 1:
        score += 0.1
        anomalies.append({
            "code": "OWNERSHIP_TRANSFER",
            "severity": "LOW",
            "feature": "ownership_transfers",
            "detail": "Provenance ownership was transferred once.",
        })
        explanation.append(
            "Ownership was transferred once; this is often routine, but confirm the receiving address is the expected maintainer."
        )

    if not record.get("active", True):
        score += 0.25
        anomalies.append({
            "code": "REVOKED",
            "severity": "MEDIUM",
            "feature": "revoked_flag",
            "detail": "The artifact was revoked by its owner on-chain.",
        })
        explanation.append(
            "This artifact was revoked on-chain by its owner — treat existing copies as superseded."
        )

    return min(score, 1.0), anomalies, explanation


class PopulationModel:
    """Isolation Forest fitted on the registered population's features."""

    def __init__(self, population_vectors: list[list[float]]):
        self.matrix = np.array(population_vectors, dtype=float)
        self.model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
        self.model.fit(self.matrix)

    def outlier_risk(self, vector: list[float]) -> tuple[float, float]:
        """Return (risk 0..1, raw decision_function). df < 0 means outlier."""
        df = float(self.model.decision_function(np.array([vector], dtype=float))[0])
        risk = 1.0 / (1.0 + math.exp(8.0 * df))
        return risk, df


def analyze(target: dict[str, Any], population: list[dict[str, Any]]) -> dict[str, Any]:
    feats = extract_features(target)
    rule_score, anomalies, explanation = rule_analysis(target, feats)

    sample_count = len(population)
    use_ml = sample_count >= MIN_SAMPLES_FOR_ML

    if use_ml:
        vectors = [extract_features(rec).vector for rec in population]
        model = PopulationModel(vectors)
        ml_risk, df = model.outlier_risk(feats.vector)
        score = min(1.0, RULE_WEIGHT * rule_score + ML_WEIGHT * ml_risk)
        if df < 0 and not any(a["code"] == "ML_OUTLIER" for a in anomalies):
            anomalies.append({
                "code": "ML_OUTLIER",
                "severity": "MEDIUM" if ml_risk < RISK_THRESHOLDS["HIGH"] else "HIGH",
                "feature": "isolation_forest",
                "detail": f"Isolation Forest isolates this artifact from the registered population (decision_function={df:.3f}).",
            })
            explanation.append(
                f"The unsupervised model finds this artifact statistically atypical relative to the {sample_count} registered artifacts. This flags unusual behavior, not proven wrongdoing."
            )
        mode = "ML"
        model_version = MODEL_VERSION_ML
    else:
        score = rule_score
        mode = "BASELINE"
        model_version = MODEL_VERSION_BASELINE
        explanation.insert(
            0,
            f"INSUFFICIENT HISTORICAL DATA — BASELINE ANALYSIS. Only {sample_count} registered artifact(s) available; the Isolation Forest activates at {MIN_SAMPLES_FOR_ML}. The score below comes from deterministic rules only.",
        )

    if not anomalies:
        explanation.append(
            "No rule-based anomaly signals triggered for this artifact's registered history."
        )

    return {
        "riskScore": round(score, 3),
        "riskLevel": risk_level(score),
        "anomalies": anomalies,
        "explanation": explanation,
        "modelVersion": model_version,
        "mode": mode,
        "sampleCount": sample_count,
        "featureCount": len(FEATURE_NAMES),
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
    }
