import { DIRS } from "../types";
import type { Board, Dir } from "../types";

export const copyBoard = (board: Board): Board => board.map((row) => row.slice());

export const flattenBoard = (board: Board): number[] => board.flat();

export const boardFromFlat = (flat: number[], size = 4): Board =>
  Array.from({ length: size }, (_, r) => flat.slice(r * size, r * size + size));

export function compactAndMerge(line: number[], size = 4) {
  const compacted = line.filter((value) => value !== 0);
  const out: number[] = [];
  const merges: number[] = [];
  let gained = 0;

  for (let i = 0; i < compacted.length; i++) {
    if (i + 1 < compacted.length && compacted[i] === compacted[i + 1]) {
      const mergedValue = compacted[i] * 2;
      out.push(mergedValue);
      gained += mergedValue;
      merges.push(out.length - 1);
      i++;
    } else {
      out.push(compacted[i]);
    }
  }

  while (out.length < size) out.push(0);
  return { out, gained, merges };
}

export function applyMove(board: Board, dir: Dir) {
  const size = board.length;
  const next = copyBoard(board);
  let scoreDelta = 0;
  const mergedPositions: [number, number][] = [];

  if (dir === "left" || dir === "right") {
    for (let r = 0; r < size; r++) {
      const row = next[r].slice();
      const raw = dir === "left" ? row : row.slice().reverse();
      const { out, gained, merges } = compactAndMerge(raw, size);
      const fin = dir === "left" ? out : out.slice().reverse();
      next[r] = fin;
      scoreDelta += gained;
      merges.forEach((i) =>
        mergedPositions.push([r, dir === "left" ? i : size - 1 - i])
      );
    }
  } else {
    for (let c = 0; c < size; c++) {
      const col = next.map((row) => row[c]);
      const raw = dir === "up" ? col : col.slice().reverse();
      const { out, gained, merges } = compactAndMerge(raw, size);
      const fin = dir === "up" ? out : out.slice().reverse();
      for (let r = 0; r < size; r++) next[r][c] = fin[r];
      scoreDelta += gained;
      merges.forEach((i) =>
        mergedPositions.push([dir === "up" ? i : size - 1 - i, c])
      );
    }
  }

  const nextFlat = flattenBoard(next);
  const prevFlat = flattenBoard(board);
  const moved = nextFlat.some((value, i) => value !== prevFlat[i]);
  return { board: next, moved, scoreDelta, mergedPositions };
}

export const legalMoves = (board: Board): Dir[] =>
  DIRS.filter((dir) => applyMove(board, dir).moved);

export const hasLegalMove = (board: Board) => legalMoves(board).length > 0;
