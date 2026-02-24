import test from "node:test";
import assert from "node:assert/strict";
import { fallbackBotMove } from "../src/bot.js";
import { buildProfile, deleteProfileState } from "../src/profile-lifecycle.js";
import type { Profile } from "../src/types.js";

test("fallbackBotMove returns left when no legal moves", () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];

  const dir = fallbackBotMove(board, () => 0.99);
  assert.equal(dir, "left");
});

test("fallbackBotMove picks first legal direction with deterministic random", () => {
  const board = [
    [0, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  const dir = fallbackBotMove(board, () => 0.2);
  assert.equal(dir, "left");
});

test("buildProfile and deleteProfileState model profile lifecycle", () => {
  const created = buildProfile({
    newName: "  ",
    profilesCount: 1,
    id: "p2",
    now: 123,
  });
  assert.equal(created.name, "Player 2");

  const existing: Profile = {
    id: "p1",
    name: "Existing",
    createdAt: 1,
    lastPlayedAt: 1,
    runs: [],
    bestScore: 0,
    bestMaxTile: 0,
    bestBotBeaten: 0,
  };

  const next = deleteProfileState({
    profiles: [existing, created],
    activeId: "p2",
    deleteId: "p2",
  });

  assert.equal(next.profiles.length, 1);
  assert.equal(next.profiles[0].id, "p1");
  assert.equal(next.activeId, null);
});
