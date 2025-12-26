import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { NullOddsGame } from "../types";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("NullOddsGameSepolia", function () {
  let signers: Signers;
  let contract: NullOddsGame;
  let contractAddress: string;
  let step: number;
  let steps: number;

  function progress(message: string) {
    console.log(`${++step}/${steps} ${message}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const deployment = await deployments.get("NullOddsGame");
      contractAddress = deployment.address;
      contract = await ethers.getContractAt("NullOddsGame", deployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  beforeEach(async () => {
    step = 0;
    steps = 0;
  });

  it("creates a game and decrypts initial balance", async function () {
    steps = 6;
    this.timeout(4 * 40000);

    progress(`Create game...`);
    const gameId = (await contract.connect(signers.alice).createGame.staticCall()) as bigint;
    const tx = await contract.connect(signers.alice).createGame();
    await tx.wait();

    progress(`Read encrypted balance...`);
    const encryptedBalance = await contract.getBalance(gameId, signers.alice.address);
    expect(encryptedBalance).to.not.eq(ethers.ZeroHash);

    progress(`Decrypt balance...`);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedBalance,
      contractAddress,
      signers.alice,
    );
    progress(`Clear balance: ${clearBalance}`);
    expect(clearBalance).to.eq(10_000);
  });
});
