import type { Board, Dir } from "./types";
import { applyMove, copyBoard, hasLegalMove, legalMoves } from "./engine/sim";

const SIZE = 4;
const START_TILES = 2;
const SPAWN_4_PROB = 0.1;

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
  const nb = copyBoard(b);
  nb[r][c] = v;
  return { board: nb, spawned: [r, c] as [number, number] | null };
};

export const countEmpty = (b: Board) => getEmptyCells(b).length;
export const maxTile = (b: Board) => Math.max(...b.flat());

export const anyMoves = hasLegalMove;

export const move = (b: Board, dir: Dir) => {
  const { board, moved, scoreDelta, mergedPositions } = applyMove(b, dir);
  return { board, moved, scoreDelta, mergedPositions };
};

export const validMoves = (b: Board) => legalMoves(b);

export const initialBoard = () => {
  let b = createEmptyBoard();
  for (let i = 0; i < START_TILES; i++) b = addRandomTile(b).board;
  return b;
};

export { legalMoves };
