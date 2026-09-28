# Smart contracts

Two contracts, Solidity 0.8.28, compiled with the IR pipeline for the Cancun EVM.
Full sources: [`blockchain/contracts/`](../blockchain/contracts). 30 Hardhat tests:
[`blockchain/test/`](../blockchain/test).

## ProofChainRegistry.sol

The provenance ledger. Deliberately dependency-free and small enough to audit in
one sitting.

### Storage model

```solidity
struct Artifact {
    uint256 id;
    string  artifactType;     // "DATASET" | "MODEL" | "SOFTWARE"
    string  name;
    string  version;
    bytes32 artifactHash;     // SHA-256 digest or Merkle root — THE commitment
    string  metadataCID;      // IPFS CID / local storage reference
    address owner;
    uint256 timestamp;        // block timestamp at registration
    uint256 parentArtifactId; // 0 = root; else version/derivation parent
    bool    active;           // false after revocation
}

mapping(uint256 => Artifact) private _artifacts;
mapping(bytes32 => uint256) public artifactIdByHash;  // uniqueness + O(1) verification
mapping(uint256 => uint256[]) private _children;      // forward lineage
```

Only the minimum for immutable provenance goes on-chain. Files never do; metadata
lives in storage behind a CID; `bytes32` is used for the fingerprint. The
`artifactIdByHash` mapping is public, so **verification requires no API at all** —
any node connection answers "is this fingerprint committed?".

### Functions

| Function | Access | Notes |
|---|---|---|
| `registerArtifact(type, name, version, hash, cid, parentId)` | anyone | rejects empty hash/fields, duplicate hashes, unknown parents; cross-owner parents allowed (derivation) |
| `updateArtifactVersion(parentId, newVersion, newHash, newCid)` | parent owner | parent must be active; child inherits type+name; emits both events |
| `transferArtifactOwnership(id, newOwner)` | owner | rejects zero address and self-transfer |
| `revokeArtifact(id)` | owner | one-way flag; the record itself is permanent |
| `verifyArtifact(hash) → (exists, id, active, owner, timestamp)` | view | the verification primitive |
| `getArtifact(id)` | view | reverts `ArtifactNotFound` for unknown ids |
| `getArtifactHistory(id)` | view | walks parent pointers; returns oldest → requested |
| `getArtifactsByOwner(owner)` | view | O(n) scan — free as an off-chain call; avoids transfer bookkeeping bugs |
| `getChildren(id)` / `totalArtifacts()` | view | graph + stats support |

### Events (the audit trail)

```solidity
event ArtifactRegistered(uint256 indexed artifactId, bytes32 indexed artifactHash,
    address indexed owner, string artifactType, string name, string version,
    string metadataCID, uint256 parentArtifactId, uint256 timestamp);
event ArtifactVersionCreated(uint256 indexed parentArtifactId, uint256 indexed newArtifactId,
    bytes32 indexed newHash, string newVersion, uint256 timestamp);
event ArtifactOwnershipTransferred(uint256 indexed artifactId,
    address indexed previousOwner, address indexed newOwner, uint256 timestamp);
event ArtifactRevoked(uint256 indexed artifactId, address indexed owner, uint256 timestamp);
```

`ArtifactRegistered` carries the full record so the application index can be rebuilt
from logs alone. Custom errors (`DuplicateArtifactHash`, `NotArtifactOwner`,
`ArtifactNotActive`, …) keep reverts cheap and machine-readable — the API translates
them into human-readable messages.

### Security properties

- **Uniqueness**: one fingerprint ↔ one artifact, enforced at registration.
- **Ownership**: version creation, transfer and revocation are owner-only *at the
  contract level* — application logins cannot override this.
- **No admin backdoor**: the registry has no owner role; nobody can mutate or
  delete another account's provenance. Revocation is a flag, not a deletion.
- **Auditability**: every state change emits an event; history is reconstructible
  from logs.

## ProofCertificate.sol (optional module)

An ERC-721 (OpenZeppelin 5) **provenance certificate** — explicitly not a financial
NFT:

- mintable once per artifact, only by the artifact's current on-chain owner, only
  while the artifact is active;
- **soulbound**: `_update` reverts on any transfer or burn, so a certificate can
  never change hands or be traded;
- `tokenURI` is fully on-chain JSON (Base64 data URI) embedding the artifact id,
  type, name, version and fingerprint;
- the core platform works without it (modular by requirement).

## Gas expectations (measured on local Hardhat)

| Operation | Gas (approx.) |
|---|---|
| `registerArtifact` | ~310k–380k (string lengths dominate) |
| `updateArtifactVersion` | ~330k |
| `transferArtifactOwnership` | ~40k |
| `revokeArtifact` | ~32k |
| `verifyArtifact` / views | 0 (off-chain call) |

## Networks

| Network | chainId | Config |
|---|---|---|
| `hardhat` (tests) | 31337 | in-process |
| `localhost` (default dev) | 31337 | `npm run chain`, no keys required |
| `sepolia` (optional) | 11155111 | `SEPOLIA_RPC_URL` + funded `PRIVATE_KEY` in `.env` |

`scripts/deploy.js` writes `blockchain/deployments/<network>.json`
(addresses + deploy block); the API reads it at startup, so addresses are never
copy-pasted by hand.
