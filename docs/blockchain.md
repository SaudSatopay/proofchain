# Blockchain layer

## Why a blockchain here at all

The honest question every "blockchain project" must answer. ProofChain's answer:

A checksum is only as trustworthy as the place it is published. If the artifact's
author (or their compromised server) can edit the published checksum, tampering is
undetectable — the attacker updates both file and digest. The property needed is a
**write-once commitment outside any single party's control**:

- **Immutability** — once `registerArtifact` is mined, no one (owner, operator,
  attacker with the API's database) can change the committed fingerprint. A demo
  "reset" must deploy a *new* contract precisely because the old ledger cannot be
  cleared — the limitation is the feature.
- **Auditability** — every registration, version, transfer and revocation is an
  event in a block; the full history reconstructs from logs.
- **Ownership** — provenance operations are authorized by wallet signatures checked
  by contract code, not by an application login table.
- **Public verifiability** — `artifactIdByHash` is a public mapping; a verifier
  needs only a node connection, not our API's cooperation.

What the blockchain is deliberately **not** used for: file storage (bytes live in
content-addressed storage), fast queries (database index), or any token/financial
mechanics.

## Hashing (the commitment content)

Implemented in [`packages/crypto`](../../packages/crypto) — isomorphic WebCrypto
(same code hashes in the browser during upload preview and in the API
authoritatively):

- **Single file** → `SHA-256(bytes)` → hex digest → `bytes32`.
- **Directory / multi-file artifact** →
  1. normalize paths (forward slashes, no `./`), reject duplicates;
  2. sort entries by path (UTF-16 code-unit order) → deterministic manifest;
  3. SHA-256 each file → leaves;
  4. build a Merkle tree: `parent = SHA-256(left_digest ‖ right_digest)`, odd node
     duplicated (Bitcoin-style); single-leaf root = the leaf;
  5. the **Merkle root** is the committed fingerprint.

Properties demonstrated: any byte change flips a leaf → flips the root; file
addition/removal/reorder changes the manifest → changes the root; inclusion proofs
(`getMerkleProof` / `verifyMerkleProof`) allow proving one file belongs to a
registered artifact without shipping the rest (tested in
`packages/crypto/test/crypto.test.ts`).

Verification failure reporting goes further than "hash mismatch": the canonical
manifest stored at registration is diffed against the uploaded set, naming exactly
which files were **modified / missing / added**.

## IPFS / storage layer

`IpfsService` ([`apps/api/src/services/storage.ts`](../../apps/api/src/services/storage.ts)):

| Mode | Reference | Label in UI | Requires |
|---|---|---|---|
| `local` (default) | `local:<sha256>` in `storage/objects/` | "Local Development Storage" | nothing |
| `pinata` | real IPFS CID | "IPFS" + gateway link | `PINATA_JWT` |

Both modes are content-addressed, so the storage reference itself is
integrity-bearing. Local mode never pretends to be IPFS (labels say what it is);
Pinata mode falls back to local with a logged warning if the pin fails, so the
platform keeps working offline. Stored per artifact: every file object, the
canonical `manifest.json`, and a `metadata.json` document (schema
`proofchain/artifact-metadata@1`) whose CID is the on-chain `metadataCID`.

## The indexer (database = rebuildable index)

[`apps/api/src/services/indexer.ts`](../../apps/api/src/services/indexer.ts) polls
every 4 s:

1. reads the last indexed block (bookmark keyed by **contract address**, so a demo
   reset with a fresh contract automatically re-indexes from its deploy block);
2. `queryFilter`s the four event types over the new block range;
3. for registrations: reads the artifact from the chain, fetches its metadata
   document by CID, upserts the index row (idempotent), records the transaction
   (from/to/gas/status/block time) and a provenance event;
4. for transfers/revocations: re-reads the artifact so owner/active always mirror
   the chain.

Server-signed operations also index synchronously so the UI reflects them
immediately; the poll loop is the safety net that also catches transactions signed
by MetaMask directly against the contract.

## Transaction lifecycle in the UI

`PREPARING → STORING → SIGNING → PENDING → CONFIRMED / FAILED` — driven by real
promise states of the prepare call, the wallet signature, `tx.wait()` and the
confirm/index round-trip. Failures surface translated reasons (rejected in wallet,
wrong network, insufficient funds, duplicate fingerprint, not the on-chain owner,
node unreachable).

## Explorer

`/app/blockchain` shows live data only: latest blocks via `provider.getBlock`
(number, hash, tx count, gas, timestamp), indexed contract transactions with
methods and gas, and the decoded event timeline. If the node is down it says so —
nothing is fabricated.

## Network switching

The deployment record (`blockchain/deployments/<network>.json`) + three env vars
(`NETWORK_NAME`, `CHAIN_ID`, `RPC_URL`) select the network. MetaMask flows prompt
`wallet_switchEthereumChain` / `wallet_addEthereumChain` when the wallet is
elsewhere. Sepolia deployment is one script invocation once an RPC URL and funded
key exist — no code changes.
