import test from "node:test";
import assert from "node:assert/strict";
import { move } from "../src/game-logic.js";
import { shouldSaveDuelRun, upsertRun } from "../src/persistence.js";
import type { Profile } from "../src/types.js";

test("move merges once per pair and returns score delta", () => {
  const board = [
    [2, 2, 2, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  const result = move(board, "left");
  assert.equal(result.moved, true);
  assert.deepEqual(result.board[0], [4, 2, 0, 0]);
  assert.equal(result.scoreDelta, 4);
  assert.deepEqual(result.mergedPositions, [[0, 0]]);
});

test("shouldSaveDuelRun only allows post-bot-win completion", () => {
  assert.equal(
    shouldSaveDuelRun({
      mode: "Duel",
      playerOver: true,
      playerScore: 3200,
      botFinalScore: 3000,
      duelAlreadySaved: false,
    }),
    true
  );

  assert.equal(
    shouldSaveDuelRun({
      mode: "Duel",
      playerOver: true,
      playerScore: 2800,
      botFinalScore: 3000,
      duelAlreadySaved: false,
    }),
    false
  );
});

test("upsertRun updates profile best fields", () => {
  const profile: Profile = {
    id: "1",
    name: "p",
    createdAt: 0,
    lastPlayedAt: 0,
    runs: [],
    bestScore: 100,
    bestMaxTile: 8,
    bestBotBeaten: 2,
  };

  const next = upsertRun(profile, {
    date: 1,
    mode: "Duel",
    score: 200,
    moves: 10,
    merges: 6,
    maxTile: 32,
    durationMs: 5000,
    difficultyLevel: 4,
    outcome: "win",
    bot: { score: 180, moves: 10, merges: 6, maxTile: 16 },
  });

  assert.equal(next.bestScore, 200);
  assert.equal(next.bestMaxTile, 32);
  assert.equal(next.bestBotBeaten, 4);
  assert.equal(next.runs.length, 1);
});
