"""
ProofChain AI service — FastAPI wrapper around analyzer.py.

    uvicorn main:app --port 8000

Endpoints:
    GET  /health      liveness + model versions
    GET  /model-info  feature list, thresholds, activation rules
    POST /analyze     {target, population} -> risk assessment
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from analyzer import (
    FEATURE_NAMES,
    MIN_SAMPLES_FOR_ML,
    MODEL_VERSION_BASELINE,
    MODEL_VERSION_ML,
    RISK_THRESHOLDS,
    analyze,
)

app = FastAPI(
    title="ProofChain AI Service",
    description="Anomaly/risk analysis for registered artifacts. Reports potential anomalies — never verdicts of malice.",
    version="1.0.0",
)


class LineageEntry(BaseModel):
    version: str = ""
    sizeBytes: int = 0
    registeredAt: str = ""


class ArtifactRecord(BaseModel):
    chainId: int
    artifactType: str = "DATASET"
    sizeBytes: int = 0
    fileCount: int = 1
    registeredAt: str = ""
    versionIndex: int = 0
    versionCount: int = 1
    lineage: list[LineageEntry] = Field(default_factory=list)
    ownershipTransfers: int = 0
    verificationCount: int = 0
    verificationFailures: int = 0
    active: bool = True


class AnalyzeRequest(BaseModel):
    target: ArtifactRecord
    population: list[ArtifactRecord] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "proofchain-ai",
        "modelVersions": [MODEL_VERSION_ML, MODEL_VERSION_BASELINE],
    }


@app.get("/model-info")
def model_info() -> dict[str, Any]:
    return {
        "mlModel": "IsolationForest (scikit-learn), n_estimators=200, contamination=auto",
        "mlModelVersion": MODEL_VERSION_ML,
        "baselineVersion": MODEL_VERSION_BASELINE,
        "minSamplesForMl": MIN_SAMPLES_FOR_ML,
        "features": FEATURE_NAMES,
        "riskThresholds": RISK_THRESHOLDS,
        "note": "Scores flag potential anomalies for investigation; they are not proof that an artifact is malicious.",
    }


@app.post("/analyze")
def analyze_endpoint(payload: AnalyzeRequest) -> dict[str, Any]:
    return analyze(
        payload.target.model_dump(),
        [record.model_dump() for record in payload.population],
    )
