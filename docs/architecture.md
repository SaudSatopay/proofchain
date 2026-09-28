# ProofChain — Architecture

## Design principle

ProofChain is **not** "a CRUD app with a blockchain badge". Each layer does the one
thing it is uniquely good at, and removing any layer breaks a real capability:

| Layer | Uniquely provides | If you removed it |
|---|---|---|
| Cryptography | A fingerprint that changes when any byte changes | No tamper detection at all |
| Blockchain | A commitment nobody — including the operator — can rewrite | Checksums become as mutable as the files |
| Storage/IPFS | Content-addressed bytes + metadata documents | Nothing to verify or re-serve |
| Database | Millisecond queries, pagination, dashboards | Every page load replays chain logs |
| AI service | Statistical anomaly signals over history | No risk triage (integrity still works) |

## System architecture

```mermaid
flowchart TB
    subgraph Client
        L[Landing page] --- C[Console SPA - React 18]
        MM[MetaMask - ethers v6]
    end
    subgraph Backend
        API[Express API :4000]
        IDX[Event indexer - 4s poll]
        STG[IpfsService - local / Pinata]
        DB[(Prisma - SQLite/PostgreSQL)]
    end
    subgraph Chain[Local Hardhat :8545 / Sepolia]
        REG[ProofChainRegistry]
        CERT[ProofCertificate ERC-721]
    end
    subgraph AI[FastAPI :8000]
        RULES[Deterministic rules]
        IF[IsolationForest]
    end

    C -->|REST /api| API
    C -->|read-only queries + signed txs| MM --> REG
    API --> STG
    API --> DB
    API -->|JSON-RPC| REG
    IDX -->|queryFilter events| REG
    IDX --> DB
    API -->|/analyze| AI
    CERT --- REG
```

## Artifact registration sequence

```mermaid
sequenceDiagram
    actor U as User
    participant W as Web app
    participant A as API
    participant S as Storage (IPFS/local)
    participant R as Registry contract
    participant B as Blockchain
    participant D as Database

    U->>W: select files + metadata
    W->>W: SHA-256 / Merkle root (WebCrypto, in-browser)
    W->>A: POST /api/artifacts/prepare (files)
    A->>A: recompute fingerprint (authoritative)
    A->>S: store files + canonical manifest + metadata doc
    A->>R: verifyArtifact(hash) — duplicate check
    A-->>W: preparedId, hash, merkleRoot, CID
    alt MetaMask path
        W->>R: registerArtifact(...) signed by user wallet
        R->>B: tx mined, ArtifactRegistered emitted
        W->>A: POST /api/artifacts/confirm (preparedId, txHash)
    else Local dev signer path
        W->>A: POST /api/artifacts/register (preparedId)
        A->>R: registerArtifact(...) signed by server dev key
        R->>B: tx mined, ArtifactRegistered emitted
    end
    A->>B: read receipt + event back
    A->>D: index artifact row + provenance event + tx
    A-->>W: artifact record (txHash, block, gas, chainId)
```

The UI shows the true machine state at every step:
`PREPARING → STORING → SIGNING → PENDING → CONFIRMED/FAILED` — success is never
claimed before the receipt confirms.

## Verification sequence

```mermaid
sequenceDiagram
    actor V as Verifier (no account needed)
    participant W as Web app
    participant A as API
    participant R as Registry contract
    participant S as Storage
    participant AI as AI service

    V->>W: drop files (optionally pick a target artifact)
    W->>A: POST /api/verify
    A->>A: fingerprint files (SHA-256 / Merkle)
    A->>R: verifyArtifact(fingerprint)
    alt hash committed on-chain
        R-->>A: exists=true, artifactId, owner, timestamp
        A-->>W: ✓ INTEGRITY VERIFIED + chain facts
    else unknown hash
        A->>S: load registered manifests
        A->>A: manifest similarity search → best candidate
        A->>R: getArtifact(candidate) — registered hash
        A-->>W: ✕ INTEGRITY MISMATCH + per-file diff (modified/missing/added)
    end
    A->>A: record VerificationEvent (+ provenance event)
    opt on demand
        W->>A: POST /api/ai/analyze
        A->>AI: history features + population
        AI-->>W: riskScore / riskLevel / anomalies / explanation
    end
```

## Artifact lifecycle

```mermaid
stateDiagram-v2
    [*] --> Prepared: files hashed + stored
    Prepared --> Registered: tx confirmed (ArtifactRegistered)
    Registered --> Registered: verifications (pass/fail recorded)
    Registered --> Superseded: updateArtifactVersion → child artifact
    Registered --> Transferred: transferArtifactOwnership
    Transferred --> Registered
    Registered --> Revoked: revokeArtifact (record stays on-chain)
    Revoked --> [*]
```

## Provenance graph model

Lineage is a single on-chain parent pointer per artifact:

- **version edge** — child has the same name+type as parent (`updateArtifactVersion`
  or a version-style `registerArtifact`);
- **derived edge** — different name/type (e.g. FloodNet Model v1 ← Flood Detection
  Dataset v1.2), which may cross owners.

The API groups artifacts into families by root ancestor (`rootChainId`) and serves
`{nodes, edges}`; the web app lays them out generation-by-generation in React Flow.

## AI analysis pipeline

```mermaid
flowchart LR
    D[(DB index)] -->|artifact + lineage +\nverifications + transfers| F[Feature extraction\n14 features]
    F --> RU[Rule baseline\nsize jumps, cadence,\nfailures, churn, revocation]
    F --> POP[Population matrix]
    POP -->|n >= 10| IFo[IsolationForest fit\nscore via decision_function → sigmoid]
    RU --> MIX[0.6·rules + 0.4·ml\n→ riskScore → LOW/MED/HIGH/CRITICAL]
    IFo --> MIX
    RU -->|n < 10| BASE[BASELINE mode\nexplicitly labeled]
```

## Why the database can never lie about provenance

Every provenance-bearing row in the database carries the chain coordinates that
prove it (`txHash`, `blockNumber`, `contractAddress`), and the indexer can rebuild
the whole index from `deployBlock` by replaying the four contract events. Anyone can
bypass the API entirely and check `artifactIdByHash(hash)` on the contract — the
database is a convenience, not an authority.
