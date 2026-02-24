import { move } from "./game-logic";
import type { Board, Dir } from "./types";

export function fallbackBotMove(board: Board, randomFn: () => number = Math.random): Dir {
  const dirs: Dir[] = ["left", "up", "right", "down"];
  const legal = dirs.filter((d) => move(board, d).moved);
  for (const d of dirs) {
    if (legal.includes(d) && randomFn() < 0.7) return d;
  }
  return legal[0] ?? "left";
}
