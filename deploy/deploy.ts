import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "node:fs";
import path from "node:path";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedNullOddsGame = await deploy("NullOddsGame", {
    from: deployer,
    log: true,
  });

  console.log(`NullOddsGame contract: `, deployedNullOddsGame.address);

  // Ensure ABI/address are available under deployments/<network>/NullOddsGame.json
  // even when hardhat-deploy is invoked without `--write true`.
  const deploymentsRoot = (hre.config.paths as any).deployments as string | undefined;
  if (deploymentsRoot && deployedNullOddsGame.abi) {
    const folder = path.join(deploymentsRoot, hre.network.name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, ".chainId"), String(hre.network.config.chainId ?? ""));
    fs.writeFileSync(
      path.join(folder, "NullOddsGame.json"),
      JSON.stringify(
        {
          address: deployedNullOddsGame.address,
          abi: deployedNullOddsGame.abi,
          transactionHash: deployedNullOddsGame.transactionHash,
        },
        null,
        2,
      ),
    );
  }
};
export default func;
func.id = "deploy_nullOddsGame"; // id required to prevent reexecution
func.tags = ["NullOddsGame"];
