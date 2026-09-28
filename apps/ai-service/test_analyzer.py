"""Tests for the anomaly analyzer: normal vs anomalous samples, baseline
fallback, rule triggers and risk-level mapping."""
from datetime import datetime, timedelta, timezone

from analyzer import (
    FEATURE_NAMES,
    MIN_SAMPLES_FOR_ML,
    analyze,
    extract_features,
    risk_level,
)


def _ts(hours_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()


def make_record(chain_id: int, **overrides) -> dict:
    base = {
        "chainId": chain_id,
        "artifactType": "DATASET",
        "sizeBytes": 40_000 + chain_id * 1000,
        "fileCount": 8,
        "registeredAt": _ts(200 - chain_id),
        "versionIndex": 0,
        "versionCount": 2,
        "lineage": [
            {"version": "v1.0", "sizeBytes": 40_000, "registeredAt": _ts(300)},
            {"version": "v1.1", "sizeBytes": 42_000, "registeredAt": _ts(200)},
        ],
        "ownershipTransfers": 0,
        "verificationCount": 3,
        "verificationFailures": 0,
        "active": True,
    }
    base.update(overrides)
    return base


def normal_population(n: int) -> list[dict]:
    return [make_record(i + 1) for i in range(n)]


def anomalous_record(chain_id: int = 99) -> dict:
    """Rapid re-releases with an 8x size jump and a failed verification."""
    return make_record(
        chain_id,
        artifactType="SOFTWARE",
        sizeBytes=2_400_000,
        versionCount=3,
        versionIndex=2,
        lineage=[
            {"version": "v1.0.0", "sizeBytes": 300_000, "registeredAt": _ts(3.0)},
            {"version": "v1.1.0", "sizeBytes": 310_000, "registeredAt": _ts(0.4)},
            {"version": "v1.1.1", "sizeBytes": 2_400_000, "registeredAt": _ts(0.1)},
        ],
        verificationCount=2,
        verificationFailures=1,
    )


class TestFeatures:
    def test_feature_vector_shape_matches_names(self):
        feats = extract_features(make_record(1))
        assert len(feats.vector) == len(FEATURE_NAMES)

    def test_size_jump_computed_from_lineage(self):
        feats = extract_features(anomalous_record())
        assert feats.max_size_jump > 7.0

    def test_failure_rate(self):
        feats = extract_features(make_record(1, verificationCount=4, verificationFailures=2))
        assert feats.failure_rate == 0.5


class TestBaselineMode:
    def test_baseline_when_insufficient_population(self):
        result = analyze(make_record(1), normal_population(MIN_SAMPLES_FOR_ML - 1))
        assert result["mode"] == "BASELINE"
        assert result["modelVersion"] == "rule-baseline-v1"
        assert "INSUFFICIENT HISTORICAL DATA" in result["explanation"][0]

    def test_normal_record_scores_low(self):
        result = analyze(make_record(1), normal_population(3))
        assert result["riskLevel"] == "LOW"
        assert result["riskScore"] < 0.35


class TestMlMode:
    def test_ml_activates_with_enough_population(self):
        population = normal_population(MIN_SAMPLES_FOR_ML) + [anomalous_record()]
        result = analyze(make_record(1), population)
        assert result["mode"] == "ML"
        assert result["modelVersion"] == "isolation-forest-v1"
        assert result["sampleCount"] == len(population)

    def test_anomalous_scores_higher_than_normal(self):
        population = normal_population(12) + [anomalous_record()]
        normal = analyze(make_record(5), population)
        anomalous = analyze(anomalous_record(), population)
        assert anomalous["riskScore"] > normal["riskScore"]
        assert anomalous["riskLevel"] in ("MEDIUM", "HIGH", "CRITICAL")
        assert normal["riskLevel"] == "LOW"


class TestRules:
    def test_size_jump_rule_fires(self):
        result = analyze(anomalous_record(), [])
        codes = {a["code"] for a in result["anomalies"]}
        assert "SIZE_JUMP" in codes
        assert "INTEGRITY_FAILURES" in codes
        assert "RAPID_REVERSIONING" in codes

    def test_revoked_and_transfer_rules(self):
        record = make_record(7, active=False, ownershipTransfers=2)
        result = analyze(record, [])
        codes = {a["code"] for a in result["anomalies"]}
        assert "REVOKED" in codes
        assert "OWNERSHIP_CHURN" in codes

    def test_language_never_claims_malice(self):
        result = analyze(anomalous_record(), normal_population(12))
        text = " ".join(result["explanation"]) + " ".join(a["detail"] for a in result["anomalies"])
        assert "malicious" not in text.lower()


class TestRiskLevels:
    def test_thresholds(self):
        assert risk_level(0.1) == "LOW"
        assert risk_level(0.4) == "MEDIUM"
        assert risk_level(0.65) == "HIGH"
        assert risk_level(0.9) == "CRITICAL"
