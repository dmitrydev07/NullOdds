import fs from 'node:fs';
import path from 'node:path';

const network = process.argv[2] ?? 'sepolia';
const root = process.cwd();

const deploymentFile = path.join(root, 'deployments', network, 'NullOddsGame.json');
if (!fs.existsSync(deploymentFile)) {
  console.error(`Missing deployment file: ${deploymentFile}`);
  console.error(`Run: npx hardhat deploy --network ${network}`);
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
const address = deployment.address;
const abi = deployment.abi;

if (typeof address !== 'string' || !address.startsWith('0x') || address.length !== 42) {
  console.error(`Invalid address in ${deploymentFile}`);
  process.exit(1);
}
if (!Array.isArray(abi)) {
  console.error(`Invalid abi in ${deploymentFile}`);
  process.exit(1);
}

const deployedOut = path.join(root, 'src', 'src', 'config', 'deployed.ts');
const contractsOut = path.join(root, 'src', 'src', 'config', 'contracts.ts');

fs.mkdirSync(path.dirname(deployedOut), { recursive: true });

fs.writeFileSync(deployedOut, `export const DEFAULT_NULL_ODDS_GAME_ADDRESS = '${address}' as const;\n`);

fs.writeFileSync(
  contractsOut,
  `export const NULL_ODDS_GAME_ABI = ${JSON.stringify(abi, null, 2)} as const;\n`,
);

console.log(`Updated:`);
console.log(`- ${path.relative(root, deployedOut)}`);
console.log(`- ${path.relative(root, contractsOut)}`);
