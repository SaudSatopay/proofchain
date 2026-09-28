const { expect } = require('chai');
const { ethers } = require('hardhat');

/** SHA-256-style bytes32 fingerprint helper for tests. */
const fp = (label) => ethers.sha256(ethers.toUtf8Bytes(label));

describe('ProofChainRegistry', () => {
  let registry;
  let deployer, alice, bob;

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('ProofChainRegistry');
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  const registerDataset = (signer = alice, overrides = {}) =>
    registry
      .connect(signer)
      .registerArtifact(
        overrides.type ?? 'DATASET',
        overrides.name ?? 'Flood Detection Dataset',
        overrides.version ?? 'v1.0',
        overrides.hash ?? fp('flood-v1.0'),
        overrides.cid ?? 'local:abc123',
        overrides.parent ?? 0
      );

  describe('registerArtifact', () => {
    it('registers an artifact and stores every field', async () => {
      await registerDataset();
      const artifact = await registry.getArtifact(1);
      expect(artifact.id).to.equal(1n);
      expect(artifact.artifactType).to.equal('DATASET');
      expect(artifact.name).to.equal('Flood Detection Dataset');
      expect(artifact.version).to.equal('v1.0');
      expect(artifact.artifactHash).to.equal(fp('flood-v1.0'));
      expect(artifact.metadataCID).to.equal('local:abc123');
      expect(artifact.owner).to.equal(alice.address);
      expect(artifact.parentArtifactId).to.equal(0n);
      expect(artifact.active).to.equal(true);
      expect(artifact.timestamp).to.be.gt(0n);
      expect(await registry.totalArtifacts()).to.equal(1n);
    });

    it('emits ArtifactRegistered with the full payload', async () => {
      await expect(registerDataset())
        .to.emit(registry, 'ArtifactRegistered')
        .withArgs(
          1n,
          fp('flood-v1.0'),
          alice.address,
          'DATASET',
          'Flood Detection Dataset',
          'v1.0',
          'local:abc123',
          0n,
          (t) => t > 0n
        );
    });

    it('rejects a duplicate fingerprint', async () => {
      await registerDataset();
      await expect(registerDataset(bob, { name: 'Copycat' }))
        .to.be.revertedWithCustomError(registry, 'DuplicateArtifactHash')
        .withArgs(fp('flood-v1.0'), 1n);
    });

    it('rejects an empty hash', async () => {
      await expect(registerDataset(alice, { hash: ethers.ZeroHash })).to.be.revertedWithCustomError(
        registry,
        'EmptyHash'
      );
    });

    it('rejects empty type, name and version', async () => {
      await expect(registerDataset(alice, { type: '' }))
        .to.be.revertedWithCustomError(registry, 'EmptyField')
        .withArgs('artifactType');
      await expect(registerDataset(alice, { name: '' }))
        .to.be.revertedWithCustomError(registry, 'EmptyField')
        .withArgs('name');
      await expect(registerDataset(alice, { version: '' }))
        .to.be.revertedWithCustomError(registry, 'EmptyField')
        .withArgs('version');
    });

    it('rejects a nonexistent parent', async () => {
      await expect(registerDataset(alice, { parent: 99 }))
        .to.be.revertedWithCustomError(registry, 'ArtifactNotFound')
        .withArgs(99n);
    });

    it('allows deriving from another owner\'s artifact (cross-owner lineage)', async () => {
      await registerDataset(alice);
      await registry
        .connect(bob)
        .registerArtifact('MODEL', 'FloodNet', 'v1.0', fp('floodnet-v1'), 'local:def', 1);
      const model = await registry.getArtifact(2);
      expect(model.parentArtifactId).to.equal(1n);
      expect(model.owner).to.equal(bob.address);
      const children = await registry.getChildren(1);
      expect(children.map(Number)).to.deep.equal([2]);
    });
  });

  describe('verifyArtifact', () => {
    it('confirms a registered fingerprint', async () => {
      await registerDataset();
      const [exists, id, active, owner] = await registry.verifyArtifact(fp('flood-v1.0'));
      expect(exists).to.equal(true);
      expect(id).to.equal(1n);
      expect(active).to.equal(true);
      expect(owner).to.equal(alice.address);
    });

    it('reports an unknown fingerprint as unregistered', async () => {
      const [exists, id] = await registry.verifyArtifact(fp('never-registered'));
      expect(exists).to.equal(false);
      expect(id).to.equal(0n);
    });

    it('a tampered fingerprint does not match the original commitment', async () => {
      await registerDataset();
      const [existsOriginal] = await registry.verifyArtifact(fp('flood-v1.0'));
      const [existsTampered] = await registry.verifyArtifact(fp('flood-v1.0-TAMPERED'));
      expect(existsOriginal).to.equal(true);
      expect(existsTampered).to.equal(false);
    });
  });

  describe('updateArtifactVersion', () => {
    beforeEach(() => registerDataset());

    it('creates a linked version owned by the caller', async () => {
      await registry
        .connect(alice)
        .updateArtifactVersion(1, 'v1.1', fp('flood-v1.1'), 'local:v11');
      const v11 = await registry.getArtifact(2);
      expect(v11.parentArtifactId).to.equal(1n);
      expect(v11.name).to.equal('Flood Detection Dataset');
      expect(v11.artifactType).to.equal('DATASET');
      expect(v11.version).to.equal('v1.1');
    });

    it('emits both ArtifactVersionCreated and ArtifactRegistered', async () => {
      const tx = registry
        .connect(alice)
        .updateArtifactVersion(1, 'v1.1', fp('flood-v1.1'), 'local:v11');
      await expect(tx)
        .to.emit(registry, 'ArtifactVersionCreated')
        .withArgs(1n, 2n, fp('flood-v1.1'), 'v1.1', (t) => t > 0n);
      await expect(tx).to.emit(registry, 'ArtifactRegistered');
    });

    it('rejects version creation by a non-owner (unauthorized operation)', async () => {
      await expect(
        registry.connect(bob).updateArtifactVersion(1, 'v1.1', fp('x'), 'local:x')
      )
        .to.be.revertedWithCustomError(registry, 'NotArtifactOwner')
        .withArgs(1n, bob.address);
    });

    it('rejects versions of revoked artifacts', async () => {
      await registry.connect(alice).revokeArtifact(1);
      await expect(
        registry.connect(alice).updateArtifactVersion(1, 'v1.1', fp('x'), 'local:x')
      )
        .to.be.revertedWithCustomError(registry, 'ArtifactNotActive')
        .withArgs(1n);
    });
  });

  describe('transferArtifactOwnership', () => {
    beforeEach(() => registerDataset());

    it('transfers ownership and emits the event', async () => {
      await expect(registry.connect(alice).transferArtifactOwnership(1, bob.address))
        .to.emit(registry, 'ArtifactOwnershipTransferred')
        .withArgs(1n, alice.address, bob.address, (t) => t > 0n);
      expect((await registry.getArtifact(1)).owner).to.equal(bob.address);
    });

    it('is reflected by getArtifactsByOwner', async () => {
      await registry.connect(alice).transferArtifactOwnership(1, bob.address);
      expect((await registry.getArtifactsByOwner(alice.address)).length).to.equal(0);
      expect((await registry.getArtifactsByOwner(bob.address)).map(Number)).to.deep.equal([1]);
    });

    it('rejects transfer by non-owner', async () => {
      await expect(
        registry.connect(bob).transferArtifactOwnership(1, bob.address)
      ).to.be.revertedWithCustomError(registry, 'NotArtifactOwner');
    });

    it('rejects zero address and self-transfer', async () => {
      await expect(
        registry.connect(alice).transferArtifactOwnership(1, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
      await expect(
        registry.connect(alice).transferArtifactOwnership(1, alice.address)
      ).to.be.revertedWithCustomError(registry, 'SelfTransfer');
    });

    it('new owner can create versions after transfer, previous owner cannot', async () => {
      await registry.connect(alice).transferArtifactOwnership(1, bob.address);
      await expect(
        registry.connect(alice).updateArtifactVersion(1, 'v1.1', fp('a'), 'local:a')
      ).to.be.revertedWithCustomError(registry, 'NotArtifactOwner');
      await registry.connect(bob).updateArtifactVersion(1, 'v1.1', fp('b'), 'local:b');
      expect((await registry.getArtifact(2)).owner).to.equal(bob.address);
    });
  });

  describe('revokeArtifact', () => {
    beforeEach(() => registerDataset());

    it('revokes and emits ArtifactRevoked', async () => {
      await expect(registry.connect(alice).revokeArtifact(1))
        .to.emit(registry, 'ArtifactRevoked')
        .withArgs(1n, alice.address, (t) => t > 0n);
      expect((await registry.getArtifact(1)).active).to.equal(false);
    });

    it('verifyArtifact reports revoked artifacts as inactive but existing', async () => {
      await registry.connect(alice).revokeArtifact(1);
      const [exists, id, active] = await registry.verifyArtifact(fp('flood-v1.0'));
      expect(exists).to.equal(true);
      expect(id).to.equal(1n);
      expect(active).to.equal(false);
    });

    it('rejects revocation by non-owner and double revocation', async () => {
      await expect(registry.connect(bob).revokeArtifact(1)).to.be.revertedWithCustomError(
        registry,
        'NotArtifactOwner'
      );
      await registry.connect(alice).revokeArtifact(1);
      await expect(registry.connect(alice).revokeArtifact(1)).to.be.revertedWithCustomError(
        registry,
        'ArtifactNotActive'
      );
    });
  });

  describe('getArtifactHistory', () => {
    it('returns the lineage chain oldest → newest', async () => {
      await registerDataset(); // id 1
      await registry.connect(alice).updateArtifactVersion(1, 'v1.1', fp('v1.1'), 'local:1');
      await registry.connect(alice).updateArtifactVersion(2, 'v1.2', fp('v1.2'), 'local:2');

      const history = await registry.getArtifactHistory(3);
      expect(history.length).to.equal(3);
      expect(history.map((a) => a.version)).to.deep.equal(['v1.0', 'v1.1', 'v1.2']);
      expect(history.map((a) => Number(a.id))).to.deep.equal([1, 2, 3]);
    });

    it('returns a single element for a root artifact', async () => {
      await registerDataset();
      const history = await registry.getArtifactHistory(1);
      expect(history.length).to.equal(1);
    });

    it('reverts for unknown ids', async () => {
      await expect(registry.getArtifactHistory(42)).to.be.revertedWithCustomError(
        registry,
        'ArtifactNotFound'
      );
      await expect(registry.getArtifact(0)).to.be.revertedWithCustomError(
        registry,
        'ArtifactNotFound'
      );
    });
  });
});
