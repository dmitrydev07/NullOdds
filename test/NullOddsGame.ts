import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { NullOddsGame, NullOddsGame__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("NullOddsGame")) as NullOddsGame__factory;
  const contract = (await factory.deploy()) as NullOddsGame;
  const address = await contract.getAddress();
  return { contract, address };
}

async function encryptBet(contractAddress: string, player: HardhatEthersSigner, amount: number) {
  return fhevm.createEncryptedInput(contractAddress, player.address).add64(BigInt(amount)).encrypt();
}

describe("NullOddsGame", function () {
  let signers: Signers;
  let contract: NullOddsGame;
  let contractAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ contract, address: contractAddress } = await deployFixture());
  });

  it("creates, joins, starts, plays a round", async function () {
    const gameId = (await contract.connect(signers.alice).createGame.staticCall()) as bigint;
    await (await contract.connect(signers.alice).createGame()).wait();

    // should appear in open games
    const open = await contract.getOpenGameIds();
    expect(open.map((x) => x.toString())).to.include(gameId.toString());

    // bob joins
    await (await contract.connect(signers.bob).joinGame(gameId)).wait();
    const openAfterJoin = await contract.getOpenGameIds();
    expect(openAfterJoin.map((x) => x.toString())).to.not.include(gameId.toString());

    // start
    await (await contract.connect(signers.alice).startGame(gameId)).wait();
    const game = await contract.getGame(gameId);
    expect(game.started).to.eq(true);
    expect(game.round).to.eq(1);

    // initial balances
    const encBalAlice0 = await contract.getBalance(gameId, signers.alice.address);
    const encBalBob0 = await contract.getBalance(gameId, signers.bob.address);
    const clearBalAlice0 = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encBalAlice0,
      contractAddress,
      signers.alice,
    );
    const clearBalBob0 = await fhevm.userDecryptEuint(FhevmType.euint64, encBalBob0, contractAddress, signers.bob);
    expect(clearBalAlice0).to.eq(10_000);
    expect(clearBalBob0).to.eq(10_000);

    // alice bets 10, bob bets 7
    const encBetAlice = await encryptBet(contractAddress, signers.alice, 10);
    const encBetBob = await encryptBet(contractAddress, signers.bob, 7);

    await (await contract.connect(signers.alice).submitBet(gameId, encBetAlice.handles[0], encBetAlice.inputProof)).wait();
    await (await contract.connect(signers.bob).submitBet(gameId, encBetBob.handles[0], encBetBob.inputProof)).wait();

    const gameAfter = await contract.getGame(gameId);
    expect(gameAfter.round).to.eq(2);
    expect(gameAfter.player1Submitted).to.eq(false);
    expect(gameAfter.player2Submitted).to.eq(false);

    const encBalAlice1 = await contract.getBalance(gameId, signers.alice.address);
    const encBalBob1 = await contract.getBalance(gameId, signers.bob.address);
    const encScoreAlice1 = await contract.getScore(gameId, signers.alice.address);
    const encScoreBob1 = await contract.getScore(gameId, signers.bob.address);

    const clearBalAlice1 = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encBalAlice1,
      contractAddress,
      signers.alice,
    );
    const clearBalBob1 = await fhevm.userDecryptEuint(FhevmType.euint64, encBalBob1, contractAddress, signers.bob);
    const clearScoreAlice1 = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encScoreAlice1,
      contractAddress,
      signers.alice,
    );
    const clearScoreBob1 = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encScoreBob1,
      contractAddress,
      signers.bob,
    );

    expect(clearBalAlice1).to.eq(9990);
    expect(clearBalBob1).to.eq(9993);
    expect(clearScoreAlice1).to.eq(1);
    expect(clearScoreBob1).to.eq(0);
  });

  it("clamps bets above balance to zero", async function () {
    const gameId = (await contract.connect(signers.alice).createGame.staticCall()) as bigint;
    await (await contract.connect(signers.alice).createGame()).wait();

    await (await contract.connect(signers.bob).joinGame(gameId)).wait();
    await (await contract.connect(signers.alice).startGame(gameId)).wait();

    const encBetAlice = await encryptBet(contractAddress, signers.alice, 20_000);
    const encBetBob = await encryptBet(contractAddress, signers.bob, 1);

    await (await contract.connect(signers.alice).submitBet(gameId, encBetAlice.handles[0], encBetAlice.inputProof)).wait();
    await (await contract.connect(signers.bob).submitBet(gameId, encBetBob.handles[0], encBetBob.inputProof)).wait();

    const encBalAlice = await contract.getBalance(gameId, signers.alice.address);
    const encBalBob = await contract.getBalance(gameId, signers.bob.address);
    const encScoreAlice = await contract.getScore(gameId, signers.alice.address);
    const encScoreBob = await contract.getScore(gameId, signers.bob.address);

    const clearBalAlice = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encBalAlice,
      contractAddress,
      signers.alice,
    );
    const clearBalBob = await fhevm.userDecryptEuint(FhevmType.euint64, encBalBob, contractAddress, signers.bob);
    const clearScoreAlice = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encScoreAlice,
      contractAddress,
      signers.alice,
    );
    const clearScoreBob = await fhevm.userDecryptEuint(FhevmType.euint32, encScoreBob, contractAddress, signers.bob);

    expect(clearBalAlice).to.eq(10_000);
    expect(clearBalBob).to.eq(9_999);
    expect(clearScoreAlice).to.eq(0);
    expect(clearScoreBob).to.eq(1);
  });
});
