# REST API reference

Base URL: `http://127.0.0.1:4000`. All responses are JSON. Errors use one shape:

```json
{ "error": { "code": "MACHINE_CODE", "message": "human-readable reason", "details": … } }
```

Common codes: `VALIDATION_ERROR` (400, zod issue list in `details`),
`UNAUTHORIZED` (401), `FORBIDDEN` (403, role mismatch), `NOT_FOUND` (404),
`FILE_TOO_LARGE` (413), `RATE_LIMITED` (429), `CHAIN_UNAVAILABLE` /
`CONTRACT_NOT_DEPLOYED` / `AI_UNAVAILABLE` (503), `TX_FAILED` / `CHAIN_ERROR`
(502), `NONCE_CONFLICT` (409, auto-resynced — retry).

**Auth**: `Authorization: Bearer <JWT>` from `/api/auth/login` (12 h expiry).
Reads are public; writes need roles. **Rate limits**: login 20/15 min,
verify 60/5 min, AI 40/5 min, demo 15/5 min.
**Uploads**: multipart field `files` (repeated) + optional `paths` — a JSON array
of relative paths aligned with the files, which is how directory structure
survives multipart. Limits: 200 MB/file, 2000 files (env-configurable).

## Auth

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/login` | `{email, password}` | `{token, user}` |
| `GET /api/auth/me` 🔒 | — | `{user}` |

## Artifacts

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/artifacts?type&q&page&pageSize` | — | paginated ledger; each item carries `latestRisk` |
| `GET /api/artifacts/:chainId` | — | full detail: artifact, lineage, children, files, verifications, analyses, transactions, events, gateway URL |
| `GET /api/artifacts/:chainId/provenance` | — | `{nodes, edges}` for the lineage family |
| `GET /api/artifacts/:chainId/blockchain` | — | indexed transactions for the artifact |
| `POST /api/artifacts/prepare` | 🔒 writer¹ | multipart files + metadata fields → hashes, stores, duplicate-checks; returns `{preparedId, artifactHash, merkleRoot, metadataCid, files, duplicate, …}` |
| `POST /api/artifacts/register` | 🔒 writer | `{preparedId}` → server dev signer sends the real tx, waits for the receipt, indexes; returns `{artifact}` |
| `POST /api/artifacts/confirm` | 🔒 writer | `{preparedId, txHash}` → verifies a MetaMask-signed tx's event matches the prepared fingerprint, indexes |
| `POST /api/artifacts/:chainId/verify` | — | multipart → verify against this artifact (manifest diff on mismatch) |
| `POST /api/artifacts/:chainId/verify-stored` | — | re-hash the stored copy vs the chain (storage-tamper detection) |
| `POST /api/artifacts/:chainId/transfer` | 🔒 writer | `{newOwner}` server-signed; contract enforces real ownership |
| `POST /api/artifacts/:chainId/revoke` | 🔒 writer | server-signed revocation |
| `POST /api/artifacts/:chainId/sync` | 🔒 any | re-index one artifact from chain (after direct wallet ops) |

¹ writer = ADMIN, RESEARCHER or DEVELOPER.

Version creation = `prepare` with `parentChainId` + `asVersion=true`, then
`register`/`confirm` (the contract call becomes `updateArtifactVersion`).

## Verification

| Method & path | Purpose |
|---|---|
| `POST /api/verify` | multipart (+ optional `targetChainId`) → `VerificationResult`: `matched`, supplied/registered hashes, method (SHA256/MERKLE), chain facts (contract, network, tx, block, timestamp), matched artifact, and `manifestDiff {modified, missing, added}` when a mismatch is attributable |
| `GET /api/verify/history` | last 60 verification events with artifact labels |

## Blockchain explorer

| Method & path | Purpose |
|---|---|
| `GET /api/blockchain/status` | chain up?, latest block, contract addresses, deploy block |
| `GET /api/blockchain/blocks?limit` | real recent blocks (hash, txs, gas, timestamp) |
| `GET /api/blockchain/transactions?page` | indexed contract txs (method, gas, status) |
| `GET /api/blockchain/events?limit` | decoded contract events with artifact labels |
| `GET /api/network/config` | network, chainId, rpcUrl, contracts, storage mode, AI up?, chain up?, server signer |

## AI

| Method & path | Purpose |
|---|---|
| `GET /api/ai/status` | service liveness + model card |
| `POST /api/ai/analyze` | `{chainId}` → runs and persists an analysis (503 if service down — never faked) |
| `GET /api/ai/analyses/:chainId` | stored analysis history |

## Dashboard

| Method & path | Purpose |
|---|---|
| `GET /api/dashboard/stats` | totals, per-type counts, risk distribution, 14-day verification/registration series, recent-block activity, recent events — all computed from real data (zeros + empty states when empty) |

## Demo (ADMIN)

| Method & path | Purpose |
|---|---|
| `GET /api/demo/status` | loaded? tampered? artifact count |
| `POST /api/demo/load` | registers the full demo registry with real transactions |
| `POST /api/demo/tamper` | rewrites stored bytes of the tamper target (backs up the original) |
| `POST /api/demo/run-verification` | verifies intact + tampered stored copies, returns both reports |
| `POST /api/demo/reset` | restores tampered objects, deploys a fresh registry, clears the index |

## Storage

| Method & path | Purpose |
|---|---|
| `GET /api/storage/:cid` | serve a stored object (`?json=1` for metadata documents); `X-Storage-Mode` header labels the backend |
