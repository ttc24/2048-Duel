import { DIRS } from "./types";
import type { Board, Dir } from "./types";

const SIZE = 4;
const START_TILES = 2;
const SPAWN_4_PROB = 0.1;

const deepCopy = (b: Board) => b.map((r) => r.slice());

export const createEmptyBoard = (): Board =>
  Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

export const getEmptyCells = (b: Board): [number, number][] => {
  const out: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === 0) out.push([r, c]);
    }
  }
  return out;
};

export const addRandomTile = (b: Board) => {
  const e = getEmptyCells(b);
  if (!e.length) return { board: b, spawned: null as [number, number] | null };
  const [r, c] = e[Math.floor(Math.random() * e.length)];
  const v = Math.random() < SPAWN_4_PROB ? 4 : 2;
  const nb = deepCopy(b);
  nb[r][c] = v;
  return { board: nb, spawned: [r, c] as [number, number] | null };
};

export const countEmpty = (b: Board) => getEmptyCells(b).length;
export const maxTile = (b: Board) => Math.max(...b.flat());

export function anyMoves(b: Board) {
  if (countEmpty(b) > 0) return true;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = b[r][c];
      if (!v) continue;
      if (r + 1 < SIZE && b[r + 1][c] === v) return true;
      if (c + 1 < SIZE && b[r][c + 1] === v) return true;
    }
  }
  return false;
}

function compact(vs: number[]) {
  const a = vs.filter((x) => x !== 0);
  const out: number[] = [];
  const merges: number[] = [];
  let gained = 0;

  for (let i = 0; i < a.length; i++) {
    if (i + 1 < a.length && a[i] === a[i + 1]) {
      const v = a[i] * 2;
      out.push(v);
      gained += v;
      merges.push(out.length - 1);
      i++;
    } else {
      out.push(a[i]);
    }
  }

  while (out.length < SIZE) out.push(0);
  return { out, gained, merges };
}

export function move(b: Board, dir: Dir) {
  const nb = deepCopy(b);
  let total = 0;
  const merged: [number, number][] = [];

  if (dir === "left" || dir === "right") {
    for (let r = 0; r < SIZE; r++) {
      const line = nb[r].slice();
      const raw = dir === "left" ? line : line.slice().reverse();
      const { out, gained, merges } = compact(raw);
      const fin = dir === "left" ? out : out.slice().reverse();
      nb[r] = fin;
      total += gained;
      merges.forEach((i) => merged.push([r, dir === "left" ? i : SIZE - 1 - i]));
    }
  } else {
    for (let c = 0; c < SIZE; c++) {
      const col = nb.map((row) => row[c]);
      const raw = dir === "up" ? col : col.slice().reverse();
      const { out, gained, merges } = compact(raw);
      const fin = dir === "up" ? out : out.slice().reverse();
      for (let r = 0; r < SIZE; r++) nb[r][c] = fin[r];
      total += gained;
      merges.forEach((i) => merged.push([dir === "up" ? i : SIZE - 1 - i, c]));
    }
  }

  const moved = JSON.stringify(nb) !== JSON.stringify(b);
  return { board: nb, moved, scoreDelta: total, mergedPositions: merged };
}

export const validMoves = (b: Board) => {
  const res: Dir[] = [];
  for (const d of DIRS) if (move(b, d).moved) res.push(d);
  return res;
};

export const initialBoard = () => {
  let b = createEmptyBoard();
  for (let i = 0; i < START_TILES; i++) b = addRandomTile(b).board;
  return b;
};
