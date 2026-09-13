import type { DifficultyMeta } from "./types";

export const DIFFICULTIES: readonly DifficultyMeta[] = [
  { level: 1, name: "Goldfish" },
  { level: 2, name: "Pigeon" },
  { level: 3, name: "Rookie" },
  { level: 4, name: "Apprentice" },
  { level: 5, name: "Tactician" },
  { level: 6, name: "Planner" },
  { level: 7, name: "Strategist" },
  { level: 8, name: "Master" },
  { level: 9, name: "Oracle" },
  { level: 10, name: "Unbeatable" },
] as const;

export const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
};

export const speedToDelay = (n: number) =>
  Math.round(460 - Math.max(1, Math.min(10, n)) * 40);
