declare const process: { argv: string[] };
import { applyMove, boardFromFlat, flattenBoard } from "../src/engine/sim";
import { PLAN, chooseMove } from "../src/engine/bot-core";
import type { Dir } from "../src/types";

type GameResult = {
  level: number;
  score: number;
  maxTile: number;
  won2048: boolean;
  moves: number;
  meanMoveMs: number;
  p95MoveMs: number;
};

function makeRng(seed: number) {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function addSpawn(flat: number[], rng: () => number) {
  const empties: number[] = [];
  for (let i = 0; i < flat.length; i++) if (flat[i] === 0) empties.push(i);
  if (!empties.length) return;
  const index = empties[Math.floor(rng() * empties.length)];
  flat[index] = rng() < 0.1 ? 4 : 2;
}

function playGame(level: number, seed: number, maxMoves: number): GameResult {
  const rng = makeRng(seed * 9719 + level * 17);
  const board = new Array(16).fill(0);
  addSpawn(board, rng);
  addSpawn(board, rng);

  let score = 0;
  let moves = 0;
  const moveTimes: number[] = [];

  while (moves < maxMoves) {
    const start = performance.now();
    const dir = chooseMove(board, score, level, (seed + 1) * 100_000 + moves);
    moveTimes.push(performance.now() - start);

    const { board: next, moved, scoreDelta } = applyMove(boardFromFlat(board), dir);
    if (!moved) break;
    score += scoreDelta;
    const flat = flattenBoard(next);
    addSpawn(flat, rng);
    for (let i = 0; i < 16; i++) board[i] = flat[i];
    moves++;

    const hasLegal = (["left", "up", "right", "down"] as Dir[]).some((d) => applyMove(next, d).moved);
    if (!hasLegal) break;
  }

  const maxTile = Math.max(...board);
  return {
    level,
    score,
    maxTile,
    won2048: maxTile >= 2048,
    moves,
    meanMoveMs: quantile(moveTimes, 0.5) ? moveTimes.reduce((a, x) => a + x, 0) / moveTimes.length : 0,
    p95MoveMs: quantile(moveTimes, 0.95),
  };
}

function summarize(level: number, games: GameResult[]) {
  const scores = games.map((g) => g.score);
  const winRate = games.filter((g) => g.won2048).length / games.length;
  const tiles: Record<number, number> = {};
  for (const g of games) tiles[g.maxTile] = (tiles[g.maxTile] ?? 0) + 1;
  const tileDist = Object.entries(tiles)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tile, count]) => `${tile}:${(count / games.length * 100).toFixed(1)}%`)
    .join(", ");

  const meanMoveMs = games.reduce((a, g) => a + g.meanMoveMs, 0) / games.length;
  const p95MoveMs = quantile(games.map((g) => g.p95MoveMs), 0.95);

  return {
    level,
    mean: scores.reduce((a, x) => a + x, 0) / scores.length,
    median: quantile(scores, 0.5),
    p25: quantile(scores, 0.25),
    p75: quantile(scores, 0.75),
    winRate,
    maxTileDist: tileDist,
    moveMean: meanMoveMs,
    moveMedian: quantile(games.map((g) => g.meanMoveMs), 0.5),
    moveP95: p95MoveMs,
  };
}

function overlapRatio(a0: number, a1: number, b0: number, b1: number) {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const span = Math.max(a1 - a0, b1 - b0, 1);
  return overlap / span;
}

async function main() {
  const gamesPerLevel = Number(process.argv[2] ?? 16);
  const maxLevel = Number(process.argv[3] ?? 10);
  const maxMoves = Number(process.argv[4] ?? 6000);
  console.log(`Bot calibration (${gamesPerLevel} games / level, levels 1-${maxLevel}, maxMoves ${maxMoves})`);
  console.log("Plan focus fields:", PLAN.map((p) => ({ level: p.level, baseDepth: p.baseDepth, timeMs: p.timeMs, epsilon: p.epsilon, temp: p.temp, evalNoise: p.evalNoise, scoreCeil: p.scoreCeil, doomMax: p.doomMax })));

  const summaries: ReturnType<typeof summarize>[] = [];
  for (let level = 1; level <= Math.min(10, maxLevel); level++) {
    const games: GameResult[] = [];
    for (let i = 0; i < gamesPerLevel; i++) games.push(playGame(level, i + 1, maxMoves));
    const s = summarize(level, games);
    summaries.push(s);
    console.log(`L${level}: score mean=${s.mean.toFixed(1)}, median=${s.median.toFixed(1)}, IQR=[${s.p25.toFixed(1)}, ${s.p75.toFixed(1)}], winRate2048=${(s.winRate * 100).toFixed(1)}%`);
    console.log(`    maxTile: ${s.maxTileDist}`);
    console.log(`    move ms: mean=${s.moveMean.toFixed(2)}, median=${s.moveMedian.toFixed(2)}, p95=${s.moveP95.toFixed(2)}`);
  }

  console.log("\nNeighbor-level separation checks");
  for (let i = 0; i < summaries.length - 1; i++) {
    const a = summaries[i];
    const b = summaries[i + 1];
    const overlap = overlapRatio(a.p25, a.p75, b.p25, b.p75);
    const meanMonotonic = b.mean > a.mean;
    const winMonotonic = b.winRate >= a.winRate;
    const scoreCollision = overlap > 0.35;
    const winCollision = Math.abs(b.winRate - a.winRate) < 0.08;
    const flags = [
      !meanMonotonic ? "non-monotonic mean score" : "",
      !winMonotonic ? "non-monotonic win-rate" : "",
      scoreCollision ? `score-band overlap ${(overlap * 100).toFixed(1)}%` : "",
      winCollision ? `win-rate collision Δ=${((b.winRate - a.winRate) * 100).toFixed(1)}pp` : "",
    ].filter(Boolean);
    const status = flags.length ? "FLAG" : "OK";
    console.log(`L${a.level}->L${b.level}: ${status} | overlap=${(overlap * 100).toFixed(1)}%, meanΔ=${(b.mean - a.mean).toFixed(1)}, winΔ=${((b.winRate - a.winRate) * 100).toFixed(1)}pp`);
    if (flags.length) console.log(`    ${flags.join("; ")}`);
  }
}

main();
