/// <reference lib="webworker" />
import { chooseMove } from "./engine/bot-core";

export {};

self.onmessage = (e: MessageEvent) => {
  const { id, type, board, score, level, rngSeed } = e.data || {};
  if (type !== "move") return;
  const dir = chooseMove(
    board as number[],
    score as number,
    level as number,
    rngSeed as number | undefined
  );
  (postMessage as (message: { id: unknown; dir: string }) => void)({ id, dir });
};
