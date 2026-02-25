import { applyMove, boardFromFlat, copyBoard, flattenBoard } from "./sim";
import type { Board, Dir } from "../types";

const DIRS: Dir[] = ["left", "up", "right", "down"];
const MOVE_PRIO: Record<Dir, number> = { left: 0, up: 1, right: 2, down: 3 };
const SPAWN_4 = 0.1;

const mkBoard = (flat: number[]): Board => boardFromFlat(flat);
const flat = (b: Board) => flattenBoard(b);
const copy = (b: Board) => copyBoard(b);

const emptyCells = (b: Board) => {
  const out: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!b[r][c]) out.push([r, c]);
  return out;
};
const countEmpty = (b: Board) => emptyCells(b).length;
const maxTile = (b: Board) => Math.max(...flat(b));

type Rng = { next: () => number };

function createRng(seed?: number): Rng {
  if (seed === undefined || !Number.isFinite(seed)) return { next: () => Math.random() };
  let state = (seed >>> 0) || 0x6d2b79f5;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function move(b: Board, dir: Dir) {
  const { board, moved, scoreDelta } = applyMove(b, dir);
  return { board, moved, gained: scoreDelta };
}
const legal = (b: Board) => DIRS.filter((d) => applyMove(b, d).moved);

const POS = [
  [7.0, 6.3, 5.6, 4.9],
  [6.4, 5.7, 5.0, 4.2],
  [5.8, 5.1, 4.4, 3.6],
  [6.6, 5.9, 5.2, 3.0],
];
function positional(b: Board) {
  let s = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = b[r][c];
    if (v) s += POS[r][c] * Math.log2(v);
  }
  return s * 36;
}
function rowMono(a: number[]) {
  const xs = a.filter(Boolean).map((v) => Math.log2(v));
  if (xs.length < 2) return 0;
  let inc = 0;
  let dec = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d >= 0) inc++;
    if (d <= 0) dec++;
  }
  return Math.max(inc, dec);
}
function monotonicity(b: Board) {
  let m = 0;
  for (let r = 0; r < 4; r++) m += rowMono(b[r]);
  for (let c = 0; c < 4; c++) m += rowMono([b[0][c], b[1][c], b[2][c], b[3][c]]);
  return m * 48;
}
function smoothness(b: Board) {
  let d = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = b[r][c];
    if (!v) continue;
    if (r + 1 < 4 && b[r + 1][c]) d += Math.abs(Math.log2(v) - Math.log2(b[r + 1][c]));
    if (c + 1 < 4 && b[r][c + 1]) d += Math.abs(Math.log2(v) - Math.log2(b[r][c + 1]));
  }
  return -d * 0.5;
}
function cornerLock(b: Board) {
  const mx = maxTile(b);
  const atCorner = b[0][0] === mx || b[0][3] === mx || b[3][0] === mx || b[3][3] === mx;
  if (!atCorner) return -Math.log2(mx || 2) * 8;
  return (b[0][0] === mx ? 6 : 2) * Math.log2(mx || 2);
}

type EvalWeights = { empty: number; mono: number; smooth: number; pos: number; corner: number; maxTile: number; score: number };

function getWeights(b: Board, score: number): EvalWeights {
  const empties = countEmpty(b);
  const mx = maxTile(b);
  const roughness = Math.max(0, -smoothness(b));
  const w: EvalWeights = { empty: 280, mono: 1, smooth: 1, pos: 1, corner: 1, maxTile: 1, score: 0.1 };
  if (empties >= 8 || mx <= 64) {
    w.empty = 330;
    w.smooth = 0.85;
    w.mono = 0.9;
    w.pos = 0.9;
    w.corner = 0.9;
    return w;
  }
  if (empties >= 4 || mx <= 512) {
    w.empty = 285;
    w.mono = 1.18;
    w.pos = 1.16;
    w.corner = 1.1;
    w.maxTile = 1.05;
    return w;
  }
  w.empty = 210;
  w.mono = 1.28;
  w.pos = 1.22;
  w.corner = 1.65;
  w.maxTile = 1.12;
  w.score = score > 12000 ? 0.08 : 0.1;
  w.smooth = roughness > 13 ? 2.1 : roughness > 8 ? 1.65 : 1.35;
  return w;
}

const evalBoard = (b: Board, score: number, noise = 0, rng?: Rng) => {
  const empties = countEmpty(b);
  const mono = monotonicity(b);
  const smooth = smoothness(b);
  const pos = positional(b);
  const corner = cornerLock(b);
  const mx = maxTile(b);
  const w = getWeights(b, score);
  return empties * w.empty + mono * w.mono + smooth * w.smooth + pos * w.pos + corner * w.corner + mx * w.maxTile + score * w.score + (noise ? ((rng?.next() ?? Math.random()) - 0.5) * noise : 0);
};

const rot90 = (b: Board) => {
  const n = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as number[][];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) n[c][3 - r] = b[r][c];
  return n as Board;
};
const rotations = (b: Board) => [b, rot90(b), rot90(rot90(b)), rot90(rot90(rot90(b)))];
const canonKey = (b: Board) => rotations(b).map((x) => flat(x).join(",")).sort()[0];

function qAfter(b: Board, d: Dir, score: number, noise: number, rng?: Rng) {
  const { board: nb, moved, gained } = move(b, d);
  return moved ? evalBoard(nb, score + gained, noise, rng) : -Infinity;
}
const orderMoves = (b: Board, score: number, noise: number, rng?: Rng) => legal(b).sort((a, b2) => qAfter(b, b2, score, noise, rng) - qAfter(b, a, score, noise, rng) || MOVE_PRIO[a] - MOVE_PRIO[b2]);

function chanceRiskScore(b: Board, [r, c]: [number, number]) {
  let score = 0;
  const neigh: [number, number][] = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  for (const [nr, nc] of neigh) {
    if (nr < 0 || nr > 3 || nc < 0 || nc > 3) continue;
    const v = b[nr][nc];
    if (!v) continue;
    score += Math.log2(v);
  }
  const edgeBonus = r === 0 || r === 3 || c === 0 || c === 3 ? 0.8 : 0;
  const cornerBonus = (r === 0 || r === 3) && (c === 0 || c === 3) ? 0.7 : 0;
  return score + edgeBonus + cornerBonus;
}

function topKChanceCells(b: Board, empties: [number, number][], k: number): [number, number][] {
  if (empties.length <= k) return empties;
  return empties.slice().sort((a, b2) => chanceRiskScore(b, b2) - chanceRiskScore(b, a) || a[0] - b2[0] || a[1] - b2[1]).slice(0, k);
}

export type Cfg = {
  level: number;
  baseDepth: number;
  boost: number;
  timeMs: number;
  sample: number;
  fullChance?: boolean;
  cache?: boolean;
  epsilon: number;
  temp: number;
  evalNoise: number;
  scoreCeil?: number;
  ceilSpan?: number;
  doomMax?: number;
};

export const PLAN: Cfg[] = [
  { level: 1, baseDepth: 0, boost: 0, timeMs: 8, sample: 3, epsilon: 0.64, temp: 2.9, evalNoise: 78, cache: false, fullChance: false, scoreCeil: 80, ceilSpan: 260, doomMax: 1.0 },
  { level: 2, baseDepth: 1, boost: 0, timeMs: 11, sample: 5, epsilon: 0.46, temp: 2.35, evalNoise: 56, cache: false, fullChance: false, scoreCeil: 420, ceilSpan: 520, doomMax: 0.95 },
  { level: 3, baseDepth: 1, boost: 0, timeMs: 15, sample: 7, epsilon: 0.33, temp: 2.0, evalNoise: 40, cache: true, fullChance: false, scoreCeil: 820, ceilSpan: 700, doomMax: 0.86 },
  { level: 4, baseDepth: 2, boost: 0, timeMs: 21, sample: 9, epsilon: 0.23, temp: 1.72, evalNoise: 28, cache: true, fullChance: false, scoreCeil: 1450, ceilSpan: 860, doomMax: 0.74 },
  { level: 5, baseDepth: 2, boost: 1, timeMs: 32, sample: 11, epsilon: 0.16, temp: 1.45, evalNoise: 19, cache: true, fullChance: false, scoreCeil: 2300, ceilSpan: 1100, doomMax: 0.62 },
  { level: 6, baseDepth: 3, boost: 1, timeMs: 50, sample: 13, epsilon: 0.1, temp: 1.28, evalNoise: 13, cache: true, fullChance: false, scoreCeil: 3200, ceilSpan: 1300, doomMax: 0.52 },
  { level: 7, baseDepth: 3, boost: 2, timeMs: 74, sample: 16, epsilon: 0.06, temp: 1.18, evalNoise: 9, cache: true, fullChance: false, scoreCeil: 4300, ceilSpan: 1550, doomMax: 0.4 },
  { level: 8, baseDepth: 4, boost: 1, timeMs: 112, sample: 19, epsilon: 0.03, temp: 1.1, evalNoise: 6, cache: true, fullChance: false, scoreCeil: 5600, ceilSpan: 1900, doomMax: 0.28 },
  { level: 9, baseDepth: 4, boost: 2, timeMs: 160, sample: 24, epsilon: 0.015, temp: 1.05, evalNoise: 3, cache: true, fullChance: false, scoreCeil: 7600, ceilSpan: 2300, doomMax: 0.16 },
  { level: 10, baseDepth: 5, boost: 2, timeMs: 900, sample: 999, epsilon: 0, temp: 1, evalNoise: 0, cache: true, fullChance: true },
];

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function applyCeiling(cfg: Cfg, score: number) {
  if (cfg.scoreCeil === undefined) return cfg;
  const over = score - cfg.scoreCeil;
  if (over <= 0) return cfg;
  const span = cfg.ceilSpan ?? 800;
  const k = clamp(over / span);
  return { ...cfg, epsilon: clamp(cfg.epsilon + 0.55 * k, 0, 0.98), temp: cfg.temp + 1.6 * k, evalNoise: cfg.evalNoise + 50 * k, doomMax: cfg.doomMax ?? 0.5, doomProb: (cfg.doomMax ?? 0.5) * k };
}

function expectimaxMove(b: Board, score: number, cfg: Cfg, rng: Rng): Dir {
  const deadline = performance.now() + cfg.timeMs;
  const TT = cfg.cache ? new Map<string, { depth: number; val: number }>() : undefined;

  const maxNode = (B: Board, sc: number, depth: number): { val: number; dir: Dir } => {
    const L = legal(B);
    if (depth === 0 || L.length === 0 || performance.now() > deadline) return { val: evalBoard(B, sc, cfg.evalNoise, rng), dir: "left" };
    let best = -Infinity;
    let bd: Dir = "left";
    for (const d of orderMoves(B, sc, cfg.evalNoise, rng)) {
      const { board: nb, moved, gained } = move(B, d);
      if (!moved) continue;
      const { val } = chanceNode(nb, sc + gained, depth - 1);
      if (val > best) {
        best = val;
        bd = d;
      }
      if (performance.now() > deadline) break;
    }
    return { val: best, dir: bd };
  };

  const chanceNode = (B: Board, sc: number, depth: number): { val: number } => {
    const key = TT ? `${canonKey(B)}:${depth}` : undefined;
    if (TT && key) {
      const hit = TT.get(key);
      if (hit && hit.depth >= depth) return { val: hit.val };
    }
    const empties = emptyCells(B);
    if (depth === 0 || empties.length === 0 || performance.now() > deadline) return { val: evalBoard(B, sc, cfg.evalNoise, rng) };

    const cells = cfg.fullChance ? empties : topKChanceCells(B, empties, Math.max(1, Math.min(cfg.sample, empties.length)));
    let acc = 0;
    for (const [r, c] of cells) {
      const b2 = copy(B);
      b2[r][c] = 2;
      acc += (1 - SPAWN_4) * maxNode(b2, sc, depth).val;
      const b4 = copy(B);
      b4[r][c] = 4;
      acc += SPAWN_4 * maxNode(b4, sc, depth).val;
      if (performance.now() > deadline) break;
    }
    const ev = acc / cells.length;
    if (TT && key) TT.set(key, { depth, val: ev });
    return { val: ev };
  };

  const L = legal(b);
  if (!L.length) return "left";

  let bestDir = orderMoves(b, score, cfg.evalNoise, rng)[0] ?? L[0];
  for (let d = cfg.baseDepth; d <= cfg.baseDepth + cfg.boost; d++) {
    const { dir } = maxNode(b, score, d);
    bestDir = dir;
    if (performance.now() > deadline) break;
  }
  return bestDir;
}

function softmaxPick(b: Board, score: number, cfg: Cfg, rng: Rng): Dir {
  const L = legal(b);
  if (!L.length) return "left";

  const best = expectimaxMove(b, score, cfg, rng);
  const evs = L.map((d) => qAfter(b, d, score, cfg.evalNoise, rng));
  const maxEv = Math.max(...evs);
  const probs = evs.map((e) => Math.exp((e - maxEv) / Math.max(1e-6, cfg.temp)));
  const sum = probs.reduce((a, x) => a + x, 0);

  let soft = L[0];
  if (sum > 0) {
    let r = rng.next() * sum;
    for (let i = 0; i < L.length; i++) {
      r -= probs[i];
      if (r <= 0) {
        soft = L[i];
        break;
      }
    }
  }

  const doomProb: number = (cfg as Cfg & { doomProb?: number }).doomProb ?? 0;
  if (doomProb && rng.next() < doomProb) {
    let worst = L[0];
    let worstEv = Infinity;
    for (let i = 0; i < L.length; i++) if (evs[i] < worstEv) {
      worstEv = evs[i];
      worst = L[i];
    }
    return worst;
  }

  const mixed = rng.next() < cfg.epsilon ? L[(rng.next() * L.length) | 0] : soft;
  return cfg.level >= 8 ? (rng.next() < 0.88 ? best : mixed) : mixed;
}

export function chooseMove(board: number[], score: number, level: number, rngSeed?: number): Dir {
  const base = PLAN[Math.max(1, Math.min(10, level)) - 1];
  const cfg = applyCeiling(base, score);
  const b = mkBoard(board);
  const rng = createRng(rngSeed);
  const L = legal(b);
  if (!L.length) return "left";

  const dir = softmaxPick(b, score, cfg, rng);
  if (move(b, dir).moved) return dir;
  for (const d of L) if (move(b, d).moved) return d;
  return L[0];
}
