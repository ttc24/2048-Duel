import type { Profile, RunRecord, Settings } from "./types";

export const LS_KEY = "duel2048_profiles_v30";
export const LS_ACTIVE = "duel2048_active_profile";
export const SETTINGS_KEY = "duel2048_settings_v30";

export const DEFAULT_SETTINGS: Settings = {
  showMoves: true,
  showMerges: true,
  showTime: true,
  showEmptyCells: false,
};

export const loadProfiles = (): Profile[] => {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as Profile[]) : [];
  } catch {
    return [];
  }
};

export const saveProfiles = (profiles: Profile[]) =>
  localStorage.setItem(LS_KEY, JSON.stringify(profiles));

export const loadActiveId = () => localStorage.getItem(LS_ACTIVE);
export const saveActiveId = (id: string) => localStorage.setItem(LS_ACTIVE, id);

export function upsertRun(profile: Profile, run: RunRecord): Profile {
  const runs = [...profile.runs, run];
  const bestScore = Math.max(profile.bestScore, run.score);
  const bestMaxTile = Math.max(profile.bestMaxTile, run.maxTile);
  const bestBotBeaten =
    run.outcome === "win" && (run.difficultyLevel ?? 0) > profile.bestBotBeaten
      ? run.difficultyLevel || 0
      : profile.bestBotBeaten;

  return {
    ...profile,
    runs,
    bestScore,
    bestMaxTile,
    bestBotBeaten,
    lastPlayedAt: Date.now(),
  };
}

export const cryptoRandomId = () => {
  try {
    return Array.from(crypto.getRandomValues(new Uint32Array(3)))
      .map((n) => n.toString(36))
      .join("");
  } catch {
    return Math.random().toString(36).slice(2);
  }
};

export const shouldSaveDuelRun = (
  params: {
    mode: "Solo" | "Duel";
    playerOver: boolean;
    playerScore: number;
    botFinalScore: number | null;
    duelAlreadySaved: boolean;
  }
) =>
  params.mode === "Duel" &&
  params.playerOver &&
  params.botFinalScore !== null &&
  params.playerScore > params.botFinalScore &&
  !params.duelAlreadySaved;
