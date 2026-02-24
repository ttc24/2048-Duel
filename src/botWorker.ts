/// <reference lib="webworker" />
import { applyMove, boardFromFlat, copyBoard, flattenBoard } from "./engine/sim";
import type { Board, Dir } from "./types";

export {};

/* 2048 botWorker v3.6
   - Expectimax with transposition table + time budget
   - Single engine; difficulty = depth/time + controlled mistakes
   - Ceiling ramp (ceilSpan + doomMax) to force natural loss on low levels
*/

const DIRS: Dir[] = ["left", "up", "right", "down"]; // tie-break favors corner play
const MOVE_PRIO: Record<Dir, number> = { left: 0, up: 1, right: 2, down: 3 };

const SPAWN_4 = 0.1; // 10% 4-tile spawns

const mkBoard = (flat: number[]): Board => boardFromFlat(flat);
const flat = (b: Board) => flattenBoard(b);
const copy = (b: Board) => copyBoard(b);

const emptyCells = (b: Board) => {
  const out: [number, number][] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) if (!b[r][c]) out.push([r, c]);
  return out;
};
const countEmpty = (b: Board) => emptyCells(b).length;
const maxTile = (b: Board) => Math.max(...flat(b));

function move(b: Board, dir: Dir) {
  const { board, moved, scoreDelta } = applyMove(b, dir);
  return { board, moved, gained: scoreDelta };
}
const legal = (b: Board) => DIRS.filter((d) => applyMove(b, d).moved);

/* ---------- Heuristic ---------- */
const POS = [
  [7.0, 6.3, 5.6, 4.9],
  [6.4, 5.7, 5.0, 4.2],
  [5.8, 5.1, 4.4, 3.6],
  [6.6, 5.9, 5.2, 3.0],
];
function positional(b: Board) {
  let s = 0;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const v = b[r][c];
      if (v) s += POS[r][c] * Math.log2(v);
    }
  return s * 36;
}
function rowMono(a: number[]) {
  const xs = a.filter(Boolean).map((v) => Math.log2(v));
  if (xs.length < 2) return 0;
  let inc = 0,
    dec = 0;
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
  for (let c = 0; c < 4; c++)
    m += rowMono([b[0][c], b[1][c], b[2][c], b[3][c]]);
  return m * 48;
}
function smoothness(b: Board) {
  let d = 0;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const v = b[r][c];
      if (!v) continue;
      if (r + 1 < 4 && b[r + 1][c])
        d += Math.abs(Math.log2(v) - Math.log2(b[r + 1][c]));
      if (c + 1 < 4 && b[r][c + 1])
        d += Math.abs(Math.log2(v) - Math.log2(b[r][c + 1]));
    }
  return -d * 0.5;
}
function cornerLock(b: Board) {
  const mx = maxTile(b);
  const atCorner =
    b[0][0] === mx || b[0][3] === mx || b[3][0] === mx || b[3][3] === mx;
  if (!atCorner) return -Math.log2(mx || 2) * 8;
  return (b[0][0] === mx ? 6 : 2) * Math.log2(mx || 2);
}

type EvalWeights = {
  empty: number;
  mono: number;
  smooth: number;
  pos: number;
  corner: number;
  maxTile: number;
  score: number;
};

function getWeights(b: Board, score: number): EvalWeights {
  const empties = countEmpty(b);
  const mx = maxTile(b);
  const roughness = Math.max(0, -smoothness(b));

  // Defaults stay close to the previous fixed multipliers.
  const w: EvalWeights = {
    empty: 280,
    mono: 1,
    smooth: 1,
    pos: 1,
    corner: 1,
    maxTile: 1,
    score: 0.1,
  };

  // Early phase: value breathing room + move options.
  if (empties >= 8 || mx <= 64) {
    w.empty = 330;
    w.smooth = 0.85;
    w.mono = 0.9;
    w.pos = 0.9;
    w.corner = 0.9;
    return w;
  }

  // Mid phase: lean into shape control and lane structure.
  if (empties >= 4 || mx <= 512) {
    w.empty = 285;
    w.mono = 1.18;
    w.pos = 1.16;
    w.corner = 1.1;
    w.maxTile = 1.05;
    return w;
  }

  // Late phase: punish rough boards and corner breaks heavily.
  w.empty = 210;
  w.mono = 1.28;
  w.pos = 1.22;
  w.corner = 1.65;
  w.maxTile = 1.12;
  w.score = score > 12000 ? 0.08 : 0.1;

  // Smoothness returns negative values, so increasing this multiplier raises roughness penalty.
  w.smooth = roughness > 13 ? 2.1 : roughness > 8 ? 1.65 : 1.35;
  return w;
}

const evalBoard = (b: Board, score: number, noise = 0) => {
  const empties = countEmpty(b);
  const mono = monotonicity(b);
  const smooth = smoothness(b);
  const pos = positional(b);
  const corner = cornerLock(b);
  const mx = maxTile(b);
  const w = getWeights(b, score);

  return (
    empties * w.empty +
    mono * w.mono +
    smooth * w.smooth +
    pos * w.pos +
    corner * w.corner +
    mx * w.maxTile +
    score * w.score +
    (noise ? (Math.random() - 0.5) * noise : 0)
  );
};

const rot90 = (b: Board) => {
  const n = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ] as number[][];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) n[c][3 - r] = b[r][c];
  return n as Board;
};
const rotations = (b: Board) => [
  b,
  rot90(b),
  rot90(rot90(b)),
  rot90(rot90(rot90(b))),
];
const canonKey = (b: Board) =>
  rotations(b)
    .map((x) => flat(x).join(","))
    .sort()[0];

function qAfter(b: Board, d: Dir, score: number, noise: number) {
  const { board: nb, moved, gained } = move(b, d);
  return moved ? evalBoard(nb, score + gained, noise) : -Infinity;
}
const orderMoves = (b: Board, score: number, noise: number) =>
  legal(b).sort(
    (a, b2) =>
      qAfter(b, b2, score, noise) - qAfter(b, a, score, noise) ||
      MOVE_PRIO[a] - MOVE_PRIO[b2]
  );

function sample<T>(a: T[], k: number) {
  if (a.length <= k) return a;
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x.slice(0, k);
}

/* ---------- Difficulty plan ---------- */
type Cfg = {
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
  scoreCeil?: number; // start ramp after this
  ceilSpan?: number; // how long to ramp (points)
  doomMax?: number; // max prob of "pick worst"
};

const PLAN: Cfg[] = [
  // L1–L4: very limited search; strong ceilings force short runs
  {
    level: 1,
    baseDepth: 0,
    boost: 0,
    timeMs: 10,
    sample: 4,
    epsilon: 0.55,
    temp: 2.5,
    evalNoise: 60,
    cache: false,
    fullChance: false,
    scoreCeil: 120,
    ceilSpan: 300,
    doomMax: 1.0,
  },
  {
    level: 2,
    baseDepth: 1,
    boost: 0,
    timeMs: 14,
    sample: 6,
    epsilon: 0.35,
    temp: 2.0,
    evalNoise: 42,
    cache: false,
    fullChance: false,
    scoreCeil: 600,
    ceilSpan: 600,
    doomMax: 0.9,
  },
  {
    level: 3,
    baseDepth: 1,
    boost: 0,
    timeMs: 18,
    sample: 8,
    epsilon: 0.25,
    temp: 1.7,
    evalNoise: 30,
    cache: true,
    fullChance: false,
    scoreCeil: 1000,
    ceilSpan: 800,
    doomMax: 0.8,
  },
  {
    level: 4,
    baseDepth: 2,
    boost: 0,
    timeMs: 24,
    sample: 10,
    epsilon: 0.15,
    temp: 1.5,
    evalNoise: 20,
    cache: true,
    fullChance: false,
    scoreCeil: 1600,
    ceilSpan: 900,
    doomMax: 0.7,
  },

  // L5–L7: medium search
  {
    level: 5,
    baseDepth: 2,
    boost: 1,
    timeMs: 36,
    sample: 12,
    epsilon: 0.1,
    temp: 1.25,
    evalNoise: 14,
    cache: true,
    fullChance: false,
    scoreCeil: 2300,
    ceilSpan: 1100,
    doomMax: 0.6,
  },
  {
    level: 6,
    baseDepth: 3,
    boost: 1,
    timeMs: 60,
    sample: 14,
    epsilon: 0.06,
    temp: 1.15,
    evalNoise: 10,
    cache: true,
    fullChance: false,
    scoreCeil: 3000,
    ceilSpan: 1300,
    doomMax: 0.5,
  },
  {
    level: 7,
    baseDepth: 3,
    boost: 2,
    timeMs: 90,
    sample: 16,
    epsilon: 0.03,
    temp: 1.1,
    evalNoise: 8,
    cache: true,
    fullChance: false,
    scoreCeil: 4000,
    ceilSpan: 1500,
    doomMax: 0.4,
  },

  // L8–L10: deep search and very rare mistakes; no ceiling for L10
  {
    level: 8,
    baseDepth: 4,
    boost: 1,
    timeMs: 130,
    sample: 18,
    epsilon: 0.02,
    temp: 1.06,
    evalNoise: 6,
    cache: true,
    fullChance: false,
    scoreCeil: 5200,
    ceilSpan: 1800,
    doomMax: 0.25,
  },
  {
    level: 9,
    baseDepth: 4,
    boost: 2,
    timeMs: 170,
    sample: 24,
    epsilon: 0.01,
    temp: 1.04,
    evalNoise: 4,
    cache: true,
    fullChance: false,
    scoreCeil: 7000,
    ceilSpan: 2200,
    doomMax: 0.15,
  },
  {
    level: 10,
    baseDepth: 5,
    boost: 2,
    timeMs: 1000,
    sample: 999,
    epsilon: 0.0,
    temp: 1.0,
    evalNoise: 0,
    cache: true,
    fullChance: true,
  }, // strongest
];

/* ---------- Ceiling ramp ---------- */
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function applyCeiling(cfg: Cfg, score: number) {
  if (cfg.scoreCeil === undefined) return cfg;
  const over = score - cfg.scoreCeil;
  if (over <= 0) return cfg;

  const span = cfg.ceilSpan ?? 800;
  const k = clamp(over / span); // 0..1 across the span

  return {
    ...cfg,
    epsilon: clamp(cfg.epsilon + 0.55 * k, 0, 0.98),
    temp: cfg.temp + 1.6 * k,
    evalNoise: cfg.evalNoise + 50 * k,
    // used in softmaxPick
    doomMax: cfg.doomMax ?? 0.5,
    // @ts-ignore
    doomProb: (cfg.doomMax ?? 0.5) * k,
  };
}

/* ---------- Expectimax ---------- */
function expectimaxMove(b: Board, score: number, cfg: Cfg): Dir {
  const deadline = performance.now() + cfg.timeMs;
  const TT = cfg.cache
    ? new Map<string, { depth: number; val: number }>()
    : undefined;

  const maxNode = (
    B: Board,
    sc: number,
    depth: number
  ): { val: number; dir: Dir } => {
    const L = legal(B);
    if (depth === 0 || L.length === 0 || performance.now() > deadline)
      return { val: evalBoard(B, sc, cfg.evalNoise), dir: "left" };

    let best = -Infinity,
      bd: Dir = "left";
    for (const d of orderMoves(B, sc, cfg.evalNoise)) {
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
    const key = TT ? canonKey(B) + ":" + depth : undefined;
    if (TT && key) {
      const hit = TT.get(key);
      if (hit && hit.depth >= depth) return { val: hit.val };
    }
    const empties = emptyCells(B);
    if (depth === 0 || empties.length === 0 || performance.now() > deadline)
      return { val: evalBoard(B, sc, cfg.evalNoise) };

    const cells = cfg.fullChance
      ? empties
      : sample(empties, Math.max(1, Math.min(cfg.sample, empties.length)));

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

  // quick ordered guess
  let bestDir = orderMoves(b, score, cfg.evalNoise)[0] ?? L[0];
  for (let d = cfg.baseDepth; d <= cfg.baseDepth + cfg.boost; d++) {
    const { dir } = maxNode(b, score, d);
    bestDir = dir;
    if (performance.now() > deadline) break;
  }
  return bestDir;
}

/* ---------- Difficulty wrapper (softmax + epsilon + doom) ---------- */
function softmaxPick(b: Board, score: number, cfg: Cfg): Dir {
  const L = legal(b);
  if (!L.length) return "left";

  const best = expectimaxMove(b, score, cfg);
  const noise = cfg.evalNoise;
  const evs = L.map((d) => qAfter(b, d, score, noise));
  const maxEv = Math.max(...evs);
  const probs = evs.map((e) =>
    Math.exp((e - maxEv) / Math.max(1e-6, cfg.temp))
  );
  const sum = probs.reduce((a, x) => a + x, 0);

  let soft = L[0];
  if (sum > 0) {
    let r = Math.random() * sum;
    for (let i = 0; i < L.length; i++) {
      r -= probs[i];
      if (r <= 0) {
        soft = L[i];
        break;
      }
    }
  }

  // Doom after ceiling: occasionally take the worst EV move (ramps to doomMax)
  // @ts-ignore
  const doomProb: number = (cfg as any).doomProb ?? 0;
  if (doomProb && Math.random() < doomProb) {
    let worst = L[0],
      worstEv = Infinity;
    for (let i = 0; i < L.length; i++)
      if (evs[i] < worstEv) {
        worstEv = evs[i];
        worst = L[i];
      }
    return worst;
  }

  // ε-greedy around soft choice; high levels prefer best
  const mixed =
    Math.random() < cfg.epsilon ? L[(Math.random() * L.length) | 0] : soft;
  return cfg.level >= 8 ? (Math.random() < 0.88 ? best : mixed) : mixed;
}

function chooseMove(board: number[], score: number, level: number): Dir {
  const base = PLAN[Math.max(1, Math.min(10, level)) - 1];
  const cfg = applyCeiling(base, score);
  const b = mkBoard(board);
  const L = legal(b);
  if (!L.length) return "left";

  const dir = softmaxPick(b, score, cfg);

  // Safety: ensure we return a direction that actually moves
  if (move(b, dir).moved) return dir;
  for (const d of L) if (move(b, d).moved) return d;
  return L[0];
}

/* ---------- Worker protocol ---------- */
self.onmessage = (e: MessageEvent) => {
  const { id, type, board, score, level } = e.data || {};
  if (type !== "move") return;
  const dir = chooseMove(board as number[], score as number, level as number);
  (postMessage as any)({ id, dir });
};
