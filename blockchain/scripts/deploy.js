/**
 * Deploys ProofChainRegistry + ProofCertificate and records the deployment
 * in blockchain/deployments/<network>.json. The API reads that file at
 * startup, so no manual copying of addresses is needed for local dev.
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying to ${network} as ${deployer.address}`);

  const Registry = await hre.ethers.getContractFactory('ProofChainRegistry');
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  const registryTx = registry.deploymentTransaction();
  const registryReceipt = await registryTx.wait();

  const Certificate = await hre.ethers.getContractFactory('ProofCertificate');
  const certificate = await Certificate.deploy(registryAddress);
  await certificate.waitForDeployment();
  const certificateAddress = await certificate.getAddress();

  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const deployment = {
    network,
    chainId,
    contractAddress: registryAddress,
    certificateAddress,
    deployer: deployer.address,
    deployTxHash: registryTx.hash,
    deployBlock: registryReceipt.blockNumber,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));

  console.log('ProofChainRegistry :', registryAddress);
  console.log('ProofCertificate   :', certificateAddress);
  console.log('Deploy block       :', registryReceipt.blockNumber);
  console.log('Recorded in        :', outFile);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
