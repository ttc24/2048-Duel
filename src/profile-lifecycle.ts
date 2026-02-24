import type { Profile } from "./types";

export function buildProfile(params: {
  newName: string;
  profilesCount: number;
  id: string;
  now: number;
}): Profile {
  const name = params.newName.trim() || `Player ${params.profilesCount + 1}`;
  return {
    id: params.id,
    name,
    createdAt: params.now,
    lastPlayedAt: params.now,
    runs: [],
    bestScore: 0,
    bestMaxTile: 0,
    bestBotBeaten: 0,
  };
}

export function deleteProfileState(params: {
  profiles: Profile[];
  activeId: string | null;
  deleteId: string;
}) {
  const profiles = params.profiles.filter((p) => p.id !== params.deleteId);
  const activeId = params.activeId === params.deleteId ? null : params.activeId;
  return { profiles, activeId };
}
