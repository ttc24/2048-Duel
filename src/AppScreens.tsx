import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BoardView, StatBadge, Tips } from "./screens";
import { countEmpty, maxTile } from "./game-logic";
import type { Board, DifficultyMeta, Profile, Screen, Settings } from "./types";

type AppScreensProps = {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  mode: "Solo" | "Duel";
  setMode: (mode: "Solo" | "Duel") => void;
  activeProfile: Profile | null;
  profiles: Profile[];
  activeId: string | null;
  onCreateProfile: (name: string) => void;
  onDeleteProfile: (id: string) => void;
  onSetActiveProfile: (id: string) => void;
  onStartSolo: () => void;
  onStartDuel: () => void;
  pBoard: Board;
  pMergedSet: Set<string>;
  pScore: number;
  pMoves: number;
  pMerges: number;
  pOver: boolean;
  pElapsed: string;
  bBoard: Board;
  bScore: number;
  bMoves: number;
  bMerges: number;
  bOver: boolean;
  winner: "Player" | "Bot" | "";
  difficulty: DifficultyMeta;
  difficulties: readonly DifficultyMeta[];
  setDifficulty: (difficulty: DifficultyMeta) => void;
  botRunning: boolean;
  setBotRunning: (running: boolean) => void;
  botSpeed: number;
  setBotSpeed: (speed: number) => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  showSettings: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  resetSide: (who: "player" | "bot") => void;
};

export function AppScreens(props: AppScreensProps) {
  return (
    <div>
      {props.screen === "menu" && <MenuScreen {...props} />}
      {props.screen === "leaderboard" && <LeaderboardScreen {...props} />}
      {props.screen === "profiles" && <ProfilesScreen {...props} />}
      {props.screen === "game" && <GameScreen {...props} />}
      <SettingsDrawer {...props} />
    </div>
  );
}

function MenuScreen(props: AppScreensProps) {
  return (
    <div className="mx-auto max-w-3xl p-6 text-stone-900 space-y-6">
      <h1 className="text-3xl font-extrabold tracking-tight">2048 Duel</h1>
      <p className="text-stone-600">Play classic 2048 or challenge a bot with 10 difficulty levels.</p>
      <div className="rounded-3xl bg-white p-4 shadow border border-stone-200 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <button type="button" onClick={props.onStartSolo} className="px-4 py-3 rounded-2xl bg-stone-800 text-white">Play Solo</button>
          <button type="button" onClick={props.onStartDuel} className="px-4 py-3 rounded-2xl bg-emerald-600 text-white">Play Duel</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => props.setScreen("profiles")} className="px-3 py-2 rounded-xl bg-stone-200">Profiles</button>
          <button type="button" onClick={() => props.setScreen("leaderboard")} className="px-3 py-2 rounded-xl bg-stone-200">Leaderboard</button>
        </div>
      </div>
    </div>
  );
}

function ProfilesScreen(props: AppScreensProps) {
  return (
    <div className="mx-auto max-w-3xl p-6 text-stone-900 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Profiles</h1>
        <button type="button" onClick={() => props.setScreen("menu")} className="px-3 py-2 rounded-xl bg-stone-200">Back</button>
      </div>
      <div className="rounded-3xl bg-white p-4 shadow border border-stone-200 space-y-3">
        {props.profiles.map((p) => (
          <div key={p.id} className={`rounded-2xl p-3 border flex items-center justify-between ${props.activeId === p.id ? "border-emerald-400" : "border-stone-200"}`}>
            <button type="button" onClick={() => props.onSetActiveProfile(p.id)} className="font-semibold">{p.name}</button>
            <div className="flex items-center gap-2 text-sm">
              <span>Best {p.bestScore}</span>
              <button type="button" onClick={() => props.onDeleteProfile(p.id)}>🗑</button>
            </div>
          </div>
        ))}
        <ProfileCreator onCreate={props.onCreateProfile} />
      </div>
    </div>
  );
}

function ProfileCreator({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New player name" className="px-3 py-2 rounded-xl border flex-1" />
      <button type="button" onClick={() => { onCreate(name); setName(""); }} className="px-3 py-2 rounded-xl bg-stone-800 text-white">Create</button>
    </div>
  );
}

function LeaderboardScreen(props: AppScreensProps) {
  const rows = props.profiles.flatMap((p) => p.runs.map((run) => ({ p, run }))).sort((a, b) => b.run.score - a.run.score).slice(0, 25);
  return (
    <div className="mx-auto max-w-4xl p-6 text-stone-900 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Leaderboard</h1>
        <button type="button" onClick={() => props.setScreen("menu")} className="px-3 py-2 rounded-xl bg-stone-200">Back</button>
      </div>
      <div className="rounded-3xl bg-white p-4 shadow border border-stone-200">
        {rows.map(({ p, run }, i) => <div key={`${p.id}-${run.date}-${i}`} className="text-sm py-1">{i + 1}. {p.name} — {run.score}</div>)}
      </div>
    </div>
  );
}

function GameScreen(props: AppScreensProps) {
  return (
    <div className="mx-auto max-w-7xl p-6 text-stone-900 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{props.mode} {props.activeProfile ? `• ${props.activeProfile.name}` : ""}</div>
        <div className="flex gap-2">
          <button type="button" onClick={props.openSettings} className="px-3 py-2 rounded-xl bg-stone-200">Settings</button>
          <button type="button" onClick={() => props.setScreen("menu")} className="px-3 py-2 rounded-xl bg-stone-200">Menu</button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
        <div className="space-y-3">
          <BoardView board={props.pBoard} mergedCells={props.pMergedSet} />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatBadge label="Score" value={props.pScore} />
            <StatBadge label="Best Tile" value={maxTile(props.pBoard)} />
            {props.settings.showMoves && <StatBadge label="Moves" value={props.pMoves} />}
            {props.settings.showMerges && <StatBadge label="Merges" value={props.pMerges} />}
            {props.settings.showTime && <StatBadge label="Time" value={props.pElapsed} />}
          </div>
        </div>
        <Tips />
        {props.mode === "Duel" && (
          <div className="space-y-3">
            <BoardView board={props.bBoard} mergedCells={new Set()} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <StatBadge label="Score" value={props.bScore} />
              <StatBadge label="Best Tile" value={maxTile(props.bBoard)} />
              {props.settings.showMoves && <StatBadge label="Moves" value={props.bMoves} />}
              {props.settings.showMerges && <StatBadge label="Merges" value={props.bMerges} />}
              {props.settings.showEmptyCells && <StatBadge label="Empty Cells" value={countEmpty(props.bBoard)} />}
            </div>
          </div>
        )}
      </div>
      <div className="text-sm text-stone-600">Winner: {props.winner || "In progress"} {props.pOver ? "• Player over" : ""} {props.bOver ? "• Bot over" : ""}</div>
    </div>
  );
}

function SettingsDrawer(props: AppScreensProps) {
  return (
    <AnimatePresence>
      {props.showSettings && (
        <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30" onClick={props.closeSettings}>
          <motion.div className="w-[min(680px,95vw)] rounded-3xl bg-white border border-stone-200 shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Settings</h3>
              <button type="button" onClick={props.closeSettings}>✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span>Bot Speed</span>
                <input type="range" min={1} max={10} value={props.botSpeed} onChange={(e) => props.setBotSpeed(parseInt(e.target.value))} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span>Bot Level</span>
                <select value={props.difficulty.level} onChange={(e) => props.setDifficulty(props.difficulties[parseInt(e.target.value) - 1])}>
                  {props.difficulties.map((d) => <option key={d.level} value={d.level}>{d.level} — {d.name}</option>)}
                </select>
              </div>
              {(["showMoves", "showMerges", "showTime", "showEmptyCells"] as (keyof Settings)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={props.settings[k]} onChange={(e) => props.setSettings((s) => ({ ...s, [k]: e.target.checked }))} />
                  {k}
                </label>
              ))}
              <div className="text-right"><button type="button" onClick={props.closeSettings} className="px-3 py-2 rounded-xl bg-stone-800 text-white">Done</button></div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
