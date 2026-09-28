# Syllabus mapping — Blockchain Technology

An honest mapping of ProofChain to the course modules. Each topic is classified:

- **IMPLEMENTED** — working code in this repository, exercised by tests/demo;
- **DEMONSTRATED** — the concept is visible and explained through the running
  system, but the mechanism itself is provided by underlying infrastructure;
- **THEORETICAL / FUTURE SCOPE** — discussed here and in docs, not built.

## Module 1 — Blockchain fundamentals

| Topic | Status | Where |
|---|---|---|
| Cryptographic hash functions (SHA-256) | **IMPLEMENTED** | `packages/crypto/src/sha256.ts` — real WebCrypto hashing in browser + server; FIPS test vectors in tests |
| Merkle trees | **IMPLEMENTED** | `packages/crypto/src/merkle.ts` — hand-built tree, odd-node duplication, inclusion proofs, tamper tests; roots committed on-chain |
| Blocks, block height, linking via previous-hash | **DEMONSTRATED** | Hardhat produces the real blocks; `/app/blockchain` shows number, hash, parentHash, timestamps — the linked structure is inspectable, not re-implemented |
| Genesis concept | **DEMONSTRATED** | fresh local chain starts at block 0; the registry's `deployBlock` acts as the index's genesis; demo reset shows a new "ledger genesis" via fresh contract |
| Immutability / tamper evidence | **IMPLEMENTED** | the product's core loop: commitment on-chain, tamper in storage, verification fails with the exact diff |

## Module 2 — Consensus, Bitcoin, mining

| Topic | Status | Notes |
|---|---|---|
| Hash-based integrity (Bitcoin's core idea) | **IMPLEMENTED** | content-addressed storage + hash commitments + Merkle roots mirror Bitcoin's use of SHA-256/Merkle for transaction integrity |
| Consensus concepts (why nodes agree) | **DEMONSTRATED** | discussed in docs/blockchain.md; the local Hardhat node is single-operator auto-mining, so consensus is simulated, not performed |
| Mining / Proof-of-Work | **THEORETICAL** | not performed (Hardhat auto-mines; Ethereum mainnet is PoS since the Merge); PoW is explained in course terms only |
| Bitcoin script / UTXO model | **THEORETICAL** | out of scope — ProofChain is account-model (Ethereum) |

## Module 3 — Ethereum

| Topic | Status | Where |
|---|---|---|
| Accounts (EOA vs contract) | **IMPLEMENTED** | EOAs sign (MetaMask user wallets, server dev signer); two deployed contract accounts |
| Transactions, gas | **IMPLEMENTED** | every registration is a real signed transaction; gas used is captured per tx and shown in the UI; error handling covers insufficient funds |
| Smart contracts & Solidity | **IMPLEMENTED** | `ProofChainRegistry.sol`, `ProofCertificate.sol` (Solidity 0.8.28, custom errors, events, modifiers, structs, mappings); 30 tests |
| EVM / compilation targets | **DEMONSTRATED** | Cancun EVM target, viaIR pipeline — build configuration explained in hardhat.config.js |
| IPFS | **IMPLEMENTED (abstraction)** | `IpfsService` with a real Pinata mode (CIDs + gateway) and an honest local content-addressed fallback; architecture identical either way |
| Oracles | **THEORETICAL** | discussed: ProofChain deliberately needs no oracle (all committed facts originate on-chain or are user-supplied hashes); Chainlink-style feeds are future scope for e.g. timestamp attestation |

## Module 4 — Private / consortium blockchains

| Topic | Status | Notes |
|---|---|---|
| Permissioned vs permissionless architecture | **DEMONSTRATED** | the local single-operator Hardhat deployment *is* a maximally private chain; the same contracts deploy unchanged to public Sepolia — the trade-off is discussed concretely |
| Hyperledger comparison | **THEORETICAL** | docs discussion: a consortium of research labs could run ProofChain-like provenance on Fabric with channel-level privacy; Ethereum chosen here for public verifiability and tooling |
| Application-level permissioning | **IMPLEMENTED** | five application roles gate API writes, deliberately separated from chain ownership — illustrating why app auth ≠ blockchain security |

## Module 5 — Tokens, wallets

| Topic | Status | Where |
|---|---|---|
| ERC-721 | **IMPLEMENTED** | `ProofCertificate.sol` — OpenZeppelin ERC-721, one certificate per artifact, on-chain tokenURI; **soulbound** (transfers revert), explicitly not a marketplace |
| ERC-20 | **THEORETICAL** | no financial token by design (spec forbids speculation features); the standard is discussed in course context |
| Wallets | **IMPLEMENTED** | MetaMask connect/network-switch/sign via ethers v6; address, network and balance shown; read-only works walletless |
| Blockchain transactions end-to-end | **IMPLEMENTED** | prepare → sign → pending → confirmed lifecycle with real receipts |

## Module 6 — Blockchain + AI, cybersecurity, supply chain

| Topic | Status | Where |
|---|---|---|
| Blockchain + AI integration | **IMPLEMENTED** | provenance data (real history from chain events) feeds a scikit-learn IsolationForest + rule engine; results stored and surfaced per artifact |
| Software supply-chain security | **IMPLEMENTED** | the SOFTWARE artifact type with repo URL/commit metadata; verify-what-you-installed workflow; anomalous-release demo (size jump + rapid re-release) |
| Cybersecurity practices | **IMPLEMENTED** | input validation (zod), upload limits, JWT + bcrypt, role-based authorization, rate limiting, helmet, no secrets in repo, `.env.example`, honest error surfaces |
| Real-world application | **DEMONSTRATED** | the full demo narrative: dataset → model → release lineage with tamper detection — a concrete AI-asset provenance scenario |

## Summary

- **IMPLEMENTED**: hashing, Merkle trees, tamper detection, Solidity contracts,
  events, gas, wallets, ERC-721 (soulbound), IPFS abstraction, indexer,
  role-based app auth, AI-on-provenance, supply-chain verification.
- **DEMONSTRATED**: block structure/linking, genesis, consensus context,
  permissioned-vs-public trade-offs, EVM configuration.
- **THEORETICAL / FUTURE SCOPE**: PoW mining, UTXO, ERC-20, oracles, Hyperledger
  deployment.
