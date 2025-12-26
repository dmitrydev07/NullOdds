import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:game:address", "Prints the NullOddsGame address").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const game = await hre.deployments.get("NullOddsGame");
  console.log("NullOddsGame address is " + game.address);
});

task("task:game:create", "Creates a new game and prints its id")
  .addOptionalParam("address", "Optionally specify the NullOddsGame contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("NullOddsGame");
    const [signer] = await ethers.getSigners();

    const contract = await ethers.getContractAt("NullOddsGame", deployment.address);
    const tx = await contract.connect(signer).createGame();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();

    const created = receipt?.logs
      .map((l) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p?.name === "GameCreated");

    const gameId = created?.args?.gameId?.toString?.() ?? "(unknown)";
    console.log(`Game created: id=${gameId}`);
  });

task("task:game:decrypt", "Decrypts your balance and score for a game")
  .addOptionalParam("address", "Optionally specify the NullOddsGame contract address")
  .addParam("gameid", "Game id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("NullOddsGame");
    const [signer] = await ethers.getSigners();
    const gameId = BigInt(taskArguments.gameid);

    const contract = await ethers.getContractAt("NullOddsGame", deployment.address);

    const encryptedBalance = await contract.getBalance(gameId, signer.address);
    const encryptedScore = await contract.getScore(gameId, signer.address);

    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      deployment.address,
      signer,
    );
    const clearScore = await fhevm.userDecryptEuint(FhevmType.euint32, encryptedScore, deployment.address, signer);

    console.log(`Clear balance: ${clearBalance}`);
    console.log(`Clear score  : ${clearScore}`);
  });

