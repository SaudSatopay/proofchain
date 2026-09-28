// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface IProofChainRegistry {
    struct Artifact {
        uint256 id;
        string artifactType;
        string name;
        string version;
        bytes32 artifactHash;
        string metadataCID;
        address owner;
        uint256 timestamp;
        uint256 parentArtifactId;
        bool active;
    }

    function getArtifact(uint256 artifactId) external view returns (Artifact memory);
}

/**
 * @title ProofCertificate
 * @notice Optional, modular ERC-721 provenance certificate.
 *
 * An artifact owner can mint exactly one certificate for an artifact they
 * own in the ProofChainRegistry. The token is SOULBOUND — it can never be
 * transferred — because it attests provenance, not value. This is
 * explicitly NOT a financial NFT: there is no marketplace, no pricing,
 * no speculation surface. The core ProofChain platform works without it.
 */
contract ProofCertificate is ERC721 {
    using Strings for uint256;

    error NotArtifactOwner(uint256 artifactId, address caller);
    error ArtifactNotActive(uint256 artifactId);
    error CertificateAlreadyMinted(uint256 artifactId, uint256 tokenId);
    error CertificateNonTransferable();

    event CertificateMinted(uint256 indexed tokenId, uint256 indexed artifactId, address indexed owner);

    IProofChainRegistry public immutable registry;

    uint256 private _nextTokenId = 1;
    mapping(uint256 => uint256) public certificateForArtifact; // artifactId → tokenId
    mapping(uint256 => uint256) public artifactForCertificate; // tokenId → artifactId

    constructor(address registryAddress) ERC721("ProofChain Provenance Certificate", "PROOF") {
        registry = IProofChainRegistry(registryAddress);
    }

    /// @notice Mint the provenance certificate for an artifact you own.
    function mintCertificate(uint256 artifactId) external returns (uint256) {
        IProofChainRegistry.Artifact memory artifact = registry.getArtifact(artifactId);
        if (artifact.owner != msg.sender) revert NotArtifactOwner(artifactId, msg.sender);
        if (!artifact.active) revert ArtifactNotActive(artifactId);
        uint256 existing = certificateForArtifact[artifactId];
        if (existing != 0) revert CertificateAlreadyMinted(artifactId, existing);

        uint256 tokenId = _nextTokenId++;
        certificateForArtifact[artifactId] = tokenId;
        artifactForCertificate[tokenId] = artifactId;
        _safeMint(msg.sender, tokenId);

        emit CertificateMinted(tokenId, artifactId, msg.sender);
        return tokenId;
    }

    function totalCertificates() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /// @notice Fully on-chain metadata referencing the attested artifact.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 artifactId = artifactForCertificate[tokenId];
        IProofChainRegistry.Artifact memory artifact = registry.getArtifact(artifactId);

        bytes memory json = abi.encodePacked(
            '{"name":"ProofChain Certificate #',
            tokenId.toString(),
            '","description":"Provenance certificate for artifact #',
            artifactId.toString(),
            ' (',
            artifact.artifactType,
            ": ",
            artifact.name,
            " ",
            artifact.version,
            ')","attributes":[{"trait_type":"artifactId","value":"',
            artifactId.toString(),
            '"},{"trait_type":"artifactHash","value":"',
            Strings.toHexString(uint256(artifact.artifactHash), 32),
            '"}]}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    /// @dev Soulbound: only minting (from == 0) is allowed. Transfers and
    ///      burns revert, so a certificate can never change hands.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0)) revert CertificateNonTransferable();
        return super._update(to, tokenId, auth);
    }
}
