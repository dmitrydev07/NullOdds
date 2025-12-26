// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint32, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title NullOddsGame
/// @notice Two-player wager game with encrypted balances and encrypted scores.
contract NullOddsGame is ZamaEthereumConfig {
    uint64 public constant INITIAL_COINS = 10_000;

    struct GamePublic {
        address player1;
        address player2;
        bool started;
        uint32 round;
        bool player1Submitted;
        bool player2Submitted;
    }

    uint256 private _nextGameId = 1;
    mapping(uint256 gameId => GamePublic) private _games;

    mapping(uint256 gameId => mapping(address player => euint64)) private _balances;
    mapping(uint256 gameId => mapping(address player => euint32)) private _scores;

    mapping(uint256 gameId => euint64) private _bet1;
    mapping(uint256 gameId => euint64) private _bet2;

    uint256[] private _openGameIds;
    mapping(uint256 gameId => uint256 indexPlusOne) private _openIndexPlusOne;

    event GameCreated(uint256 indexed gameId, address indexed player1);
    event GameJoined(uint256 indexed gameId, address indexed player2);
    event GameStarted(uint256 indexed gameId);
    event BetSubmitted(uint256 indexed gameId, address indexed player, uint32 round);
    event RoundResolved(uint256 indexed gameId, uint32 newRound);

    error GameNotFound(uint256 gameId);
    error NotAPlayer();
    error GameFull();
    error GameNotFull();
    error GameAlreadyStarted();
    error GameNotStarted();
    error CannotJoinOwnGame();

    function createGame() external returns (uint256 gameId) {
        gameId = _nextGameId++;

        GamePublic storage g = _games[gameId];
        g.player1 = msg.sender;
        g.player2 = address(0);
        g.started = false;
        g.round = 0;
        g.player1Submitted = false;
        g.player2Submitted = false;

        _initPlayer(gameId, msg.sender);
        _addOpenGame(gameId);

        emit GameCreated(gameId, msg.sender);
    }

    function joinGame(uint256 gameId) external {
        GamePublic storage g = _getGame(gameId);
        if (g.started) revert GameAlreadyStarted();
        if (g.player2 != address(0)) revert GameFull();
        if (msg.sender == g.player1) revert CannotJoinOwnGame();

        g.player2 = msg.sender;
        _initPlayer(gameId, msg.sender);
        _removeOpenGame(gameId);

        emit GameJoined(gameId, msg.sender);
    }

    function startGame(uint256 gameId) external {
        GamePublic storage g = _getGame(gameId);
        if (g.started) revert GameAlreadyStarted();
        if (g.player2 == address(0)) revert GameNotFull();
        if (msg.sender != g.player1 && msg.sender != g.player2) revert NotAPlayer();

        g.started = true;
        g.round = 1;
        g.player1Submitted = false;
        g.player2Submitted = false;

        emit GameStarted(gameId);
    }

    function submitBet(uint256 gameId, externalEuint64 bet, bytes calldata inputProof) external {
        GamePublic storage g = _getGame(gameId);
        if (!g.started) revert GameNotStarted();
        if (msg.sender != g.player1 && msg.sender != g.player2) revert NotAPlayer();

        euint64 betValue = FHE.fromExternal(bet, inputProof);
        FHE.allowThis(betValue);

        if (msg.sender == g.player1) {
            _bet1[gameId] = betValue;
            g.player1Submitted = true;
        } else {
            _bet2[gameId] = betValue;
            g.player2Submitted = true;
        }

        emit BetSubmitted(gameId, msg.sender, g.round);

        if (g.player1Submitted && g.player2Submitted) {
            _resolveRound(gameId, g);
        }
    }

    function getGame(uint256 gameId) external view returns (GamePublic memory) {
        return _getGame(gameId);
    }

    function getOpenGameIds() external view returns (uint256[] memory) {
        return _openGameIds;
    }

    /// @notice Returns encrypted balance of `player` in `gameId`.
    /// @dev View methods must not rely on msg.sender; ACL controls user decryption.
    function getBalance(uint256 gameId, address player) external view returns (euint64) {
        _revertIfGameMissing(gameId);
        return _balances[gameId][player];
    }

    /// @notice Returns encrypted score of `player` in `gameId`.
    /// @dev View methods must not rely on msg.sender; ACL controls user decryption.
    function getScore(uint256 gameId, address player) external view returns (euint32) {
        _revertIfGameMissing(gameId);
        return _scores[gameId][player];
    }

    function _resolveRound(uint256 gameId, GamePublic storage g) internal {
        address p1 = g.player1;
        address p2 = g.player2;

        euint64 balance1 = _balances[gameId][p1];
        euint64 balance2 = _balances[gameId][p2];

        euint64 bet1 = FHE.select(FHE.ge(balance1, _bet1[gameId]), _bet1[gameId], FHE.asEuint64(0));
        euint64 bet2 = FHE.select(FHE.ge(balance2, _bet2[gameId]), _bet2[gameId], FHE.asEuint64(0));

        _setBalance(gameId, p1, FHE.sub(balance1, bet1));
        _setBalance(gameId, p2, FHE.sub(balance2, bet2));

        _setScore(
            gameId,
            p1,
            FHE.add(_scores[gameId][p1], FHE.select(FHE.gt(bet1, bet2), FHE.asEuint32(1), FHE.asEuint32(0)))
        );
        _setScore(
            gameId,
            p2,
            FHE.add(_scores[gameId][p2], FHE.select(FHE.gt(bet2, bet1), FHE.asEuint32(1), FHE.asEuint32(0)))
        );

        g.player1Submitted = false;
        g.player2Submitted = false;
        g.round += 1;

        emit RoundResolved(gameId, g.round);
    }

    function _setBalance(uint256 gameId, address player, euint64 newBalance) internal {
        _balances[gameId][player] = newBalance;
        FHE.allowThis(_balances[gameId][player]);
        FHE.allow(_balances[gameId][player], player);
    }

    function _setScore(uint256 gameId, address player, euint32 newScore) internal {
        _scores[gameId][player] = newScore;
        FHE.allowThis(_scores[gameId][player]);
        FHE.allow(_scores[gameId][player], player);
    }

    function _initPlayer(uint256 gameId, address player) internal {
        euint64 initialBalance = FHE.asEuint64(INITIAL_COINS);
        euint32 initialScore = FHE.asEuint32(0);

        _balances[gameId][player] = initialBalance;
        FHE.allowThis(_balances[gameId][player]);
        FHE.allow(_balances[gameId][player], player);

        _scores[gameId][player] = initialScore;
        FHE.allowThis(_scores[gameId][player]);
        FHE.allow(_scores[gameId][player], player);
    }

    function _addOpenGame(uint256 gameId) internal {
        if (_openIndexPlusOne[gameId] != 0) return;
        _openGameIds.push(gameId);
        _openIndexPlusOne[gameId] = _openGameIds.length;
    }

    function _removeOpenGame(uint256 gameId) internal {
        uint256 indexPlusOne = _openIndexPlusOne[gameId];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _openGameIds.length - 1;
        if (index != lastIndex) {
            uint256 lastId = _openGameIds[lastIndex];
            _openGameIds[index] = lastId;
            _openIndexPlusOne[lastId] = index + 1;
        }
        _openGameIds.pop();
        delete _openIndexPlusOne[gameId];
    }

    function _getGame(uint256 gameId) internal view returns (GamePublic storage) {
        _revertIfGameMissing(gameId);
        return _games[gameId];
    }

    function _revertIfGameMissing(uint256 gameId) internal view {
        if (_games[gameId].player1 == address(0)) revert GameNotFound(gameId);
    }
}
