// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofChainRegistry
 * @notice Immutable provenance registry for digital artifacts (AI datasets,
 *         ML models, software releases).
 *
 * Design principles:
 *  - The chain stores only the minimum needed for immutable provenance:
 *    a bytes32 cryptographic fingerprint (SHA-256 digest or Merkle root),
 *    a content identifier for off-chain metadata, ownership and lineage.
 *    Large files live in IPFS/local storage; fast queries live in the
 *    application database. Neither can forge what is committed here.
 *  - Every state change emits an event, so the full audit trail can be
 *    reconstructed from logs alone.
 *  - Artifact hashes are unique: registering the same fingerprint twice
 *    is rejected, which also makes hash → artifact lookup unambiguous.
 *  - Lineage is a parent pointer: a new version points at the artifact it
 *    supersedes; a derived artifact (e.g. a model trained on a dataset)
 *    points at its source. History is walked on-chain via view functions.
 */
contract ProofChainRegistry {
    struct Artifact {
        uint256 id;
        string artifactType;    // "DATASET" | "MODEL" | "SOFTWARE"
        string name;
        string version;
        bytes32 artifactHash;   // SHA-256 digest or Merkle root
        string metadataCID;     // IPFS CID or local storage reference
        address owner;
        uint256 timestamp;      // block timestamp at registration
        uint256 parentArtifactId; // 0 = no parent
        bool active;            // false after revocation
    }

    // ── Errors ──────────────────────────────────────────────
    error EmptyHash();
    error EmptyField(string field);
    error DuplicateArtifactHash(bytes32 artifactHash, uint256 existingArtifactId);
    error ArtifactNotFound(uint256 artifactId);
    error NotArtifactOwner(uint256 artifactId, address caller);
    error ArtifactNotActive(uint256 artifactId);
    error ZeroAddress();
    error SelfTransfer();

    // ── Events ──────────────────────────────────────────────
    event ArtifactRegistered(
        uint256 indexed artifactId,
        bytes32 indexed artifactHash,
        address indexed owner,
        string artifactType,
        string name,
        string version,
        string metadataCID,
        uint256 parentArtifactId,
        uint256 timestamp
    );

    event ArtifactVersionCreated(
        uint256 indexed parentArtifactId,
        uint256 indexed newArtifactId,
        bytes32 indexed newHash,
        string newVersion,
        uint256 timestamp
    );

    event ArtifactOwnershipTransferred(
        uint256 indexed artifactId,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );

    event ArtifactRevoked(uint256 indexed artifactId, address indexed owner, uint256 timestamp);

    // ── Storage ─────────────────────────────────────────────
    uint256 private _nextId = 1;
    mapping(uint256 => Artifact) private _artifacts;
    mapping(uint256 => uint256[]) private _children;

    /// @notice Fingerprint → artifact id (0 when unregistered). Public so
    ///         anyone can verify a hash commitment with a single call.
    mapping(bytes32 => uint256) public artifactIdByHash;

    // ── Modifiers ───────────────────────────────────────────
    modifier exists(uint256 artifactId) {
        if (artifactId == 0 || artifactId >= _nextId) revert ArtifactNotFound(artifactId);
        _;
    }

    modifier onlyArtifactOwner(uint256 artifactId) {
        if (_artifacts[artifactId].owner != msg.sender) {
            revert NotArtifactOwner(artifactId, msg.sender);
        }
        _;
    }

    // ── Write functions ─────────────────────────────────────

    /**
     * @notice Commit an artifact fingerprint to the chain.
     * @param artifactType   DATASET | MODEL | SOFTWARE (free string, validated off-chain)
     * @param name           Human-readable artifact name
     * @param version        Version label, e.g. "v1.0"
     * @param artifactHash   SHA-256 digest (single file) or Merkle root (file set)
     * @param metadataCID    IPFS CID (or local storage reference in development)
     * @param parentArtifactId Lineage parent (previous version or source artifact), 0 for none
     */
    function registerArtifact(
        string calldata artifactType,
        string calldata name,
        string calldata version,
        bytes32 artifactHash,
        string calldata metadataCID,
        uint256 parentArtifactId
    ) external returns (uint256) {
        return _register(artifactType, name, version, artifactHash, metadataCID, parentArtifactId);
    }

    /**
     * @notice Register a new version of an artifact you own. The new record
     *         inherits type and name from the parent and links back to it.
     */
    function updateArtifactVersion(
        uint256 parentArtifactId,
        string calldata newVersion,
        bytes32 newHash,
        string calldata newMetadataCID
    )
        external
        exists(parentArtifactId)
        onlyArtifactOwner(parentArtifactId)
        returns (uint256)
    {
        Artifact storage parent = _artifacts[parentArtifactId];
        if (!parent.active) revert ArtifactNotActive(parentArtifactId);

        uint256 newId = _register(
            parent.artifactType,
            parent.name,
            newVersion,
            newHash,
            newMetadataCID,
            parentArtifactId
        );

        emit ArtifactVersionCreated(parentArtifactId, newId, newHash, newVersion, block.timestamp);
        return newId;
    }

    /// @notice Hand provenance ownership of an artifact to another address.
    function transferArtifactOwnership(uint256 artifactId, address newOwner)
        external
        exists(artifactId)
        onlyArtifactOwner(artifactId)
    {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == msg.sender) revert SelfTransfer();

        address previousOwner = _artifacts[artifactId].owner;
        _artifacts[artifactId].owner = newOwner;

        emit ArtifactOwnershipTransferred(artifactId, previousOwner, newOwner, block.timestamp);
    }

    /**
     * @notice Mark an artifact as revoked (e.g. a compromised release).
     *         The record itself stays on-chain forever — revocation is an
     *         auditable state change, not a deletion.
     */
    function revokeArtifact(uint256 artifactId)
        external
        exists(artifactId)
        onlyArtifactOwner(artifactId)
    {
        Artifact storage artifact = _artifacts[artifactId];
        if (!artifact.active) revert ArtifactNotActive(artifactId);
        artifact.active = false;

        emit ArtifactRevoked(artifactId, msg.sender, block.timestamp);
    }

    // ── Read functions ──────────────────────────────────────

    /**
     * @notice Verify a fingerprint against the registry.
     * @return exists_    True when this exact hash was registered
     * @return artifactId Registered artifact id (0 when not found)
     * @return active     False when the artifact was revoked
     * @return owner      Current provenance owner
     * @return timestamp  Registration block timestamp
     */
    function verifyArtifact(bytes32 artifactHash)
        external
        view
        returns (bool exists_, uint256 artifactId, bool active, address owner, uint256 timestamp)
    {
        uint256 id = artifactIdByHash[artifactHash];
        if (id == 0) return (false, 0, false, address(0), 0);
        Artifact storage a = _artifacts[id];
        return (true, id, a.active, a.owner, a.timestamp);
    }

    function getArtifact(uint256 artifactId)
        external
        view
        exists(artifactId)
        returns (Artifact memory)
    {
        return _artifacts[artifactId];
    }

    /**
     * @notice Full lineage of an artifact: walks parent pointers to the root.
     * @return chain Artifacts ordered oldest → the requested artifact.
     */
    function getArtifactHistory(uint256 artifactId)
        external
        view
        exists(artifactId)
        returns (Artifact[] memory chain)
    {
        uint256 depth = 1;
        uint256 cursor = artifactId;
        while (_artifacts[cursor].parentArtifactId != 0) {
            cursor = _artifacts[cursor].parentArtifactId;
            depth++;
        }

        chain = new Artifact[](depth);
        cursor = artifactId;
        for (uint256 i = depth; i > 0; i--) {
            chain[i - 1] = _artifacts[cursor];
            cursor = _artifacts[cursor].parentArtifactId;
        }
    }

    /**
     * @notice Ids of artifacts currently owned by `owner`.
     * @dev O(n) scan — acceptable because this is a view function evaluated
     *      off-chain (no gas), and it avoids error-prone storage bookkeeping
     *      when ownership transfers.
     */
    function getArtifactsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i < _nextId; i++) {
            if (_artifacts[i].owner == owner) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 j;
        for (uint256 i = 1; i < _nextId; i++) {
            if (_artifacts[i].owner == owner) ids[j++] = i;
        }
        return ids;
    }

    /// @notice Direct descendants (versions or derived artifacts).
    function getChildren(uint256 artifactId) external view returns (uint256[] memory) {
        return _children[artifactId];
    }

    function totalArtifacts() external view returns (uint256) {
        return _nextId - 1;
    }

    // ── Internal ────────────────────────────────────────────

    function _register(
        string memory artifactType,
        string memory name,
        string memory version,
        bytes32 artifactHash,
        string memory metadataCID,
        uint256 parentArtifactId
    ) internal returns (uint256) {
        if (artifactHash == bytes32(0)) revert EmptyHash();
        if (bytes(artifactType).length == 0) revert EmptyField("artifactType");
        if (bytes(name).length == 0) revert EmptyField("name");
        if (bytes(version).length == 0) revert EmptyField("version");

        uint256 existing = artifactIdByHash[artifactHash];
        if (existing != 0) revert DuplicateArtifactHash(artifactHash, existing);

        if (parentArtifactId != 0 && (parentArtifactId >= _nextId)) {
            revert ArtifactNotFound(parentArtifactId);
        }

        uint256 id = _nextId++;
        _artifacts[id] = Artifact({
            id: id,
            artifactType: artifactType,
            name: name,
            version: version,
            artifactHash: artifactHash,
            metadataCID: metadataCID,
            owner: msg.sender,
            timestamp: block.timestamp,
            parentArtifactId: parentArtifactId,
            active: true
        });
        artifactIdByHash[artifactHash] = id;
        if (parentArtifactId != 0) {
            _children[parentArtifactId].push(id);
        }

        emit ArtifactRegistered(
            id,
            artifactHash,
            msg.sender,
            artifactType,
            name,
            version,
            metadataCID,
            parentArtifactId,
            block.timestamp
        );
        return id;
    }
}
