import { Contract, Interface } from 'ethers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, http, isAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { useAccount, useChainId } from 'wagmi';

import { NULL_ODDS_GAME_ABI } from '../config/contracts';
import { DEFAULT_NULL_ODDS_GAME_ADDRESS } from '../config/deployed';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { Header } from './Header';

import '../styles/NullOddsApp.css';

const SEPOLIA_CHAIN_ID = 11155111;

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

type GamePublic = {
  player1: `0x${string}`;
  player2: `0x${string}`;
  started: boolean;
  round: number;
  player1Submitted: boolean;
  player2Submitted: boolean;
};

function shortAddress(addr: string) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function toGamePublic(raw: any): GamePublic {
  const player1 = (raw?.player1 ?? raw?.[0]) as `0x${string}`;
  const player2 = (raw?.player2 ?? raw?.[1]) as `0x${string}`;
  const started = Boolean(raw?.started ?? raw?.[2]);
  const roundRaw = raw?.round ?? raw?.[3];
  const round = typeof roundRaw === 'bigint' ? Number(roundRaw) : Number(roundRaw ?? 0);
  const player1Submitted = Boolean(raw?.player1Submitted ?? raw?.[4]);
  const player2Submitted = Boolean(raw?.player2Submitted ?? raw?.[5]);
  return { player1, player2, started, round, player1Submitted, player2Submitted };
}

function getUrlParam(name: string) {
  try {
    return new URLSearchParams(window.location.search).get(name) ?? '';
  } catch {
    return '';
  }
}

function setUrlParams(next: Record<string, string>) {
  try {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(next)) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // ignore
  }
}

export function NullOddsApp() {
  const { address } = useAccount();
  const chainId = useChainId();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contractAddress, setContractAddress] = useState<string>(
    () => getUrlParam('contract') || DEFAULT_NULL_ODDS_GAME_ADDRESS,
  );
  const [selectedGameId, setSelectedGameId] = useState<string>(() => getUrlParam('game'));
  const [openGames, setOpenGames] = useState<bigint[]>([]);
  const [game, setGame] = useState<GamePublic | null>(null);

  const [betAmount, setBetAmount] = useState<string>('1');
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [myBalance, setMyBalance] = useState<bigint | null>(null);
  const [myScore, setMyScore] = useState<bigint | null>(null);

  const decryptSessionRef = useRef<{
    contractAddress: `0x${string}`;
    keypair: { publicKey: string; privateKey: string };
    startTimeStamp: string;
    durationDays: string;
    signature: string;
  } | null>(null);

  const contractAddressTyped = useMemo(() => {
    if (!isAddress(contractAddress)) return null;
    return contractAddress as `0x${string}`;
  }, [contractAddress]);

  const selectedGameIdBigInt = useMemo(() => {
    try {
      if (!selectedGameId) return null;
      const v = BigInt(selectedGameId);
      if (v <= 0n) return null;
      return v;
    } catch {
      return null;
    }
  }, [selectedGameId]);

  const isOnSepolia = chainId === SEPOLIA_CHAIN_ID;

  const isPlayer = useMemo(() => {
    if (!address || !game) return false;
    return address.toLowerCase() === game.player1.toLowerCase() || address.toLowerCase() === game.player2.toLowerCase();
  }, [address, game]);

  const mySubmitted = useMemo(() => {
    if (!address || !game) return false;
    if (address.toLowerCase() === game.player1.toLowerCase()) return game.player1Submitted;
    if (address.toLowerCase() === game.player2.toLowerCase()) return game.player2Submitted;
    return false;
  }, [address, game]);

  async function refreshOpenGames() {
    if (!contractAddressTyped) return;
    const ids = (await publicClient.readContract({
      address: contractAddressTyped,
      abi: NULL_ODDS_GAME_ABI,
      functionName: 'getOpenGameIds',
    })) as bigint[];
    setOpenGames(ids);
  }

  async function refreshSelectedGame() {
    if (!contractAddressTyped || !selectedGameIdBigInt) {
      setGame(null);
      return;
    }
    const raw = await publicClient.readContract({
      address: contractAddressTyped,
      abi: NULL_ODDS_GAME_ABI,
      functionName: 'getGame',
      args: [selectedGameIdBigInt],
    });
    setGame(toGamePublic(raw));
  }

  async function ensureDecryptSession(contract: `0x${string}`) {
    if (!instance || !address || !signerPromise) throw new Error('Wallet or encryption service not ready');

    const cached = decryptSessionRef.current;
    if (cached && cached.contractAddress.toLowerCase() === contract.toLowerCase()) return cached;

    const keypair = instance.generateKeypair();
    const startTimeStamp = Math.floor(Date.now() / 1000).toString();
    const durationDays = '10';
    const contractAddresses = [contract];
    const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

    const signer = await signerPromise;
    if (!signer) throw new Error('Signer not available');

    const signature = await signer.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message,
    );

    decryptSessionRef.current = { contractAddress: contract, keypair, startTimeStamp, durationDays, signature };
    return decryptSessionRef.current;
  }

  async function decryptMyStats() {
    if (!contractAddressTyped || !selectedGameIdBigInt || !address) return;
    if (!instance) return;

    setIsBusy(true);
    setStatus('Decrypting your balance and score…');
    try {
      const encryptedBalance = (await publicClient.readContract({
        address: contractAddressTyped,
        abi: NULL_ODDS_GAME_ABI,
        functionName: 'getBalance',
        args: [selectedGameIdBigInt, address],
      })) as `0x${string}`;

      const encryptedScore = (await publicClient.readContract({
        address: contractAddressTyped,
        abi: NULL_ODDS_GAME_ABI,
        functionName: 'getScore',
        args: [selectedGameIdBigInt, address],
      })) as `0x${string}`;

      const session = await ensureDecryptSession(contractAddressTyped);

      const handleContractPairs = [
        { handle: encryptedBalance, contractAddress: contractAddressTyped },
        { handle: encryptedScore, contractAddress: contractAddressTyped },
      ];

      const result = await instance.userDecrypt(
        handleContractPairs,
        session.keypair.privateKey,
        session.keypair.publicKey,
        session.signature.replace('0x', ''),
        [contractAddressTyped],
        address,
        session.startTimeStamp,
        session.durationDays,
      );

      const balance = result[encryptedBalance] as bigint | undefined;
      const score = result[encryptedScore] as bigint | undefined;
      setMyBalance(typeof balance === 'bigint' ? balance : null);
      setMyScore(typeof score === 'bigint' ? score : null);
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to decrypt');
    } finally {
      setIsBusy(false);
    }
  }

  async function withWrite(action: (c: Contract) => Promise<void>) {
    if (!contractAddressTyped) throw new Error('Invalid contract address');
    if (!signerPromise) throw new Error('Wallet not connected');
    const signer = await signerPromise;
    if (!signer) throw new Error('Signer not available');
    const c = new Contract(contractAddressTyped, NULL_ODDS_GAME_ABI, signer);
    await action(c);
  }

  async function createGame() {
    setIsBusy(true);
    setStatus('Creating game…');
    try {
      await withWrite(async (c) => {
        const tx = await c.createGame();
        const receipt = await tx.wait();
        const iface = new Interface(NULL_ODDS_GAME_ABI as any);
        const parsed = receipt.logs
          .filter((l: any) => (l?.address ?? '').toLowerCase() === contractAddressTyped?.toLowerCase())
          .map((l: any) => {
            try {
              return iface.parseLog(l);
            } catch {
              return null;
            }
          })
          .find((p: any) => p?.name === 'GameCreated');

        const gameId = parsed?.args?.gameId?.toString?.();
        if (gameId) {
          setSelectedGameId(gameId);
          setUrlParams({ game: gameId });
        }
      });
      await refreshOpenGames();
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to create game');
    } finally {
      setIsBusy(false);
    }
  }

  async function joinGame(gameId: bigint) {
    setIsBusy(true);
    setStatus(`Joining game ${gameId.toString()}…`);
    try {
      await withWrite(async (c) => {
        const tx = await c.joinGame(gameId);
        await tx.wait();
      });
      setSelectedGameId(gameId.toString());
      setUrlParams({ game: gameId.toString() });
      await refreshOpenGames();
      await refreshSelectedGame();
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to join game');
    } finally {
      setIsBusy(false);
    }
  }

  async function startGame() {
    if (!selectedGameIdBigInt) return;
    setIsBusy(true);
    setStatus('Starting game…');
    try {
      await withWrite(async (c) => {
        const tx = await c.startGame(selectedGameIdBigInt);
        await tx.wait();
      });
      await refreshSelectedGame();
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to start game');
    } finally {
      setIsBusy(false);
    }
  }

  async function submitBet() {
    if (!instance || !address || !contractAddressTyped || !selectedGameIdBigInt) return;
    const amount = Number(betAmount);
    if (!Number.isInteger(amount) || amount < 0) {
      setStatus('Bet must be a non-negative integer');
      return;
    }

    setIsBusy(true);
    setStatus('Encrypting and submitting bet…');
    try {
      const input = instance.createEncryptedInput(contractAddressTyped, address);
      input.add64(BigInt(amount));
      const encryptedInput = await input.encrypt();

      await withWrite(async (c) => {
        const tx = await c.submitBet(selectedGameIdBigInt, encryptedInput.handles[0], encryptedInput.inputProof);
        await tx.wait();
      });

      await refreshSelectedGame();
      setStatus('');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Failed to submit bet');
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    setUrlParams({ contract: contractAddress });
    decryptSessionRef.current = null;
    setMyBalance(null);
    setMyScore(null);
    setOpenGames([]);
    setGame(null);
  }, [contractAddress]);

  useEffect(() => {
    setUrlParams({ game: selectedGameId });
    setMyBalance(null);
    setMyScore(null);
  }, [selectedGameId]);

  useEffect(() => {
    if (!contractAddressTyped) return;
    refreshOpenGames().catch(() => undefined);
  }, [contractAddressTyped]);

  useEffect(() => {
    refreshSelectedGame().catch(() => undefined);
  }, [contractAddressTyped, selectedGameIdBigInt]);

  useEffect(() => {
    if (!contractAddressTyped) return;
    const id = window.setInterval(() => {
      refreshOpenGames().catch(() => undefined);
      refreshSelectedGame().catch(() => undefined);
    }, 6_000);
    return () => window.clearInterval(id);
  }, [contractAddressTyped, selectedGameIdBigInt]);

  return (
    <div className="app-shell">
      <Header />
      <main className="main">
        <div className="panel">
          <h2 className="panel-title">Contract</h2>
          <p className="muted">
            This app reads from Sepolia via a public RPC and uses the Zama Relayer for encryption/decryption.
          </p>
          <div className="row">
            <label className="label" htmlFor="contractAddress">
              Contract address
            </label>
            <input
              id="contractAddress"
              className="input"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="0x…"
              spellCheck={false}
            />
          </div>
          {!contractAddressTyped && contractAddress && <p className="error">Invalid address.</p>}
          {!isOnSepolia && address && (
            <p className="error">Please switch your wallet network to Sepolia.</p>
          )}
          {zamaError && <p className="error">{zamaError}</p>}
          {zamaLoading && <p className="muted">Initializing encryption service…</p>}
        </div>

        <div className="grid">
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Lobby</h2>
              <button
                className="button"
                onClick={createGame}
                disabled={isBusy || !contractAddressTyped || !address || !isOnSepolia}
              >
                Create game
              </button>
            </div>
            <div className="row">
              <label className="label" htmlFor="gameId">
                Game id
              </label>
              <input
                id="gameId"
                className="input"
                value={selectedGameId}
                onChange={(e) => setSelectedGameId(e.target.value.trim())}
                placeholder="e.g. 1"
                spellCheck={false}
              />
            </div>

            <div className="open-games">
              <div className="open-games-header">
                <h3 className="subtitle">Open games</h3>
                <button
                  className="button-secondary"
                  onClick={() => refreshOpenGames()}
                  disabled={!contractAddressTyped || isBusy}
                >
                  Refresh
                </button>
              </div>
              {!contractAddressTyped ? (
                <p className="muted">Enter a contract address to load games.</p>
              ) : openGames.length === 0 ? (
                <p className="muted">No open games found.</p>
              ) : (
                <ul className="open-games-list">
                  {openGames.map((id) => (
                    <li key={id.toString()} className="open-game-item">
                      <button className="link" onClick={() => setSelectedGameId(id.toString())}>
                        Game #{id.toString()}
                      </button>
                      <button
                        className="button-small"
                        onClick={() => joinGame(id)}
                        disabled={isBusy || !address || !isOnSepolia}
                      >
                        Join
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Game</h2>
              <button
                className="button-secondary"
                onClick={() => refreshSelectedGame()}
                disabled={!contractAddressTyped || !selectedGameIdBigInt || isBusy}
              >
                Refresh
              </button>
            </div>

            {!contractAddressTyped || !selectedGameIdBigInt ? (
              <p className="muted">Select a game id to view state.</p>
            ) : !game ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <div className="kv">
                  <div className="kv-item">
                    <span className="kv-key">Player 1</span>
                    <span className="kv-val">{shortAddress(game.player1)}</span>
                  </div>
                  <div className="kv-item">
                    <span className="kv-key">Player 2</span>
                    <span className="kv-val">{game.player2 === '0x0000000000000000000000000000000000000000' ? '—' : shortAddress(game.player2)}</span>
                  </div>
                  <div className="kv-item">
                    <span className="kv-key">Started</span>
                    <span className="kv-val">{game.started ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="kv-item">
                    <span className="kv-key">Round</span>
                    <span className="kv-val">{game.round}</span>
                  </div>
                  <div className="kv-item">
                    <span className="kv-key">Submissions</span>
                    <span className="kv-val">
                      {game.player1Submitted ? 'P1 ✓' : 'P1 —'} / {game.player2Submitted ? 'P2 ✓' : 'P2 —'}
                    </span>
                  </div>
                </div>

                {!game.started && game.player2 !== '0x0000000000000000000000000000000000000000' && isPlayer && (
                  <button className="button" onClick={startGame} disabled={isBusy || !isOnSepolia}>
                    Start game
                  </button>
                )}

                {game.started && isPlayer && (
                  <div className="bet-box">
                    <div className="panel-header">
                      <h3 className="subtitle">Your stats</h3>
                      <button className="button-secondary" onClick={decryptMyStats} disabled={isBusy || !instance}>
                        Decrypt
                      </button>
                    </div>
                    <div className="kv">
                      <div className="kv-item">
                        <span className="kv-key">Balance</span>
                        <span className="kv-val">{myBalance === null ? '—' : myBalance.toString()}</span>
                      </div>
                      <div className="kv-item">
                        <span className="kv-key">Score</span>
                        <span className="kv-val">{myScore === null ? '—' : myScore.toString()}</span>
                      </div>
                    </div>

                    <h3 className="subtitle">Submit bet</h3>
                    <div className="row">
                      <label className="label" htmlFor="betAmount">
                        Coins
                      </label>
                      <input
                        id="betAmount"
                        className="input"
                        value={betAmount}
                        onChange={(e) => setBetAmount(e.target.value)}
                        inputMode="numeric"
                        placeholder="e.g. 25"
                      />
                      <button
                        className="button"
                        onClick={submitBet}
                        disabled={isBusy || mySubmitted || !isOnSepolia || zamaLoading}
                      >
                        {mySubmitted ? 'Submitted' : 'Submit'}
                      </button>
                    </div>
                    {mySubmitted && <p className="muted">Waiting for the other player…</p>}
                  </div>
                )}

                {!isPlayer && address && (
                  <p className="muted">Connect as one of the players to start and submit bets.</p>
                )}
              </>
            )}
          </section>
        </div>

        {status && <div className="toast">{status}</div>}
      </main>
    </div>
  );
}
