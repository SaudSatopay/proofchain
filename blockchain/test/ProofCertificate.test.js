const { expect } = require('chai');
const { ethers } = require('hardhat');

const fp = (label) => ethers.sha256(ethers.toUtf8Bytes(label));

describe('ProofCertificate', () => {
  let registry, certificate;
  let alice, bob;

  beforeEach(async () => {
    [, alice, bob] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('ProofChainRegistry');
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    const Certificate = await ethers.getContractFactory('ProofCertificate');
    certificate = await Certificate.deploy(await registry.getAddress());
    await certificate.waitForDeployment();

    await registry
      .connect(alice)
      .registerArtifact('DATASET', 'Flood Detection Dataset', 'v1.0', fp('d1'), 'local:1', 0);
  });

  it('lets the artifact owner mint exactly one certificate', async () => {
    await expect(certificate.connect(alice).mintCertificate(1))
      .to.emit(certificate, 'CertificateMinted')
      .withArgs(1n, 1n, alice.address);
    expect(await certificate.ownerOf(1)).to.equal(alice.address);
    expect(await certificate.certificateForArtifact(1)).to.equal(1n);
    expect(await certificate.artifactForCertificate(1)).to.equal(1n);
    expect(await certificate.totalCertificates()).to.equal(1n);

    await expect(certificate.connect(alice).mintCertificate(1))
      .to.be.revertedWithCustomError(certificate, 'CertificateAlreadyMinted')
      .withArgs(1n, 1n);
  });

  it('rejects minting by non-owners', async () => {
    await expect(certificate.connect(bob).mintCertificate(1))
      .to.be.revertedWithCustomError(certificate, 'NotArtifactOwner')
      .withArgs(1n, bob.address);
  });

  it('rejects minting for revoked artifacts', async () => {
    await registry.connect(alice).revokeArtifact(1);
    await expect(certificate.connect(alice).mintCertificate(1)).to.be.revertedWithCustomError(
      certificate,
      'ArtifactNotActive'
    );
  });

  it('is soulbound — transfers always revert', async () => {
    await certificate.connect(alice).mintCertificate(1);
    await expect(
      certificate.connect(alice).transferFrom(alice.address, bob.address, 1)
    ).to.be.revertedWithCustomError(certificate, 'CertificateNonTransferable');
    await expect(
      certificate
        .connect(alice)
        ['safeTransferFrom(address,address,uint256)'](alice.address, bob.address, 1)
    ).to.be.revertedWithCustomError(certificate, 'CertificateNonTransferable');
  });

  it('serves on-chain JSON metadata referencing the artifact', async () => {
    await certificate.connect(alice).mintCertificate(1);
    const uri = await certificate.tokenURI(1);
    expect(uri).to.match(/^data:application\/json;base64,/);
    const json = JSON.parse(
      Buffer.from(uri.replace('data:application/json;base64,', ''), 'base64').toString('utf8')
    );
    expect(json.name).to.contain('ProofChain Certificate #1');
    expect(json.description).to.contain('artifact #1');
    expect(json.attributes.find((a) => a.trait_type === 'artifactId').value).to.equal('1');
  });
});
