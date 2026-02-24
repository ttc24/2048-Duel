export const DIRS = ["left", "right", "up", "down"] as const;
export type Dir = (typeof DIRS)[number];

export type Board = number[][];

export type RunRecord = {
  date: number;
  mode: "Solo" | "Duel";
  score: number;
  moves: number;
  merges: number;
  maxTile: number;
  durationMs: number;
  difficultyLevel?: number;
  outcome: "win" | "loss" | "solo";
  bot?: { score: number; moves: number; merges: number; maxTile: number };
};

export type Profile = {
  id: string;
  name: string;
  createdAt: number;
  lastPlayedAt: number;
  runs: RunRecord[];
  bestScore: number;
  bestMaxTile: number;
  bestBotBeaten: number;
};

export type Settings = {
  showMoves: boolean;
  showMerges: boolean;
  showTime: boolean;
  showEmptyCells: boolean;
};

export type Screen = "menu" | "game" | "leaderboard" | "profiles";

export type DifficultyMeta = { level: number; name: string };
