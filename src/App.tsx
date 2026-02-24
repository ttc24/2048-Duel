// App.tsx — 2048 Duel v3.4 (worker bots + race-proof step + refined UI)
// Requires: src/botWorker.ts (v3.4) in the same folder.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  addRandomTile,
  anyMoves,
  countEmpty,
  createEmptyBoard,
  initialBoard,
  maxTile,
  move,
  validMoves,
} from "./game-logic";
import { useIntervalSeq } from "./hooks";
import {
  cryptoRandomId,
  DEFAULT_SETTINGS,
  loadActiveId,
  loadProfiles,
  saveActiveId,
  saveProfiles,
  SETTINGS_KEY,
  shouldSaveDuelRun,
  upsertRun,
} from "./persistence";
import { BoardView, StatBadge, Tips } from "./screens";
import type { Board, DifficultyMeta, Dir, Profile, RunRecord, Screen, Settings } from "./types";

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000),
    m = Math.floor(s / 60),
    ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
};
const speedToDelay = (n: number) =>
  Math.round(460 - Math.max(1, Math.min(10, n)) * 40);

/* =========================
   App
   ========================= */
const DIFFICULTIES: readonly DifficultyMeta[] = [
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

export default function Duel2048() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [mode, setMode] = useState<"Solo" | "Duel">("Duel");

  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const activeProfile = profiles.find((p) => p.id === activeId) || null;

  // Player state
  const [pBoard, setPBoard] = useState<Board>(() => initialBoard());
  const [pScore, setPScore] = useState(0);
  const [pMoves, setPMoves] = useState(0);
  const [pMerges, setPMerges] = useState(0);
  const [pOver, setPOver] = useState(false);
  const [pStartAt, setPStartAt] = useState<number>(() => Date.now());
  const [pMergedSet, setPMergedSet] = useState<Set<string>>(new Set());

  // Bot state
  const [bBoard, setBBoard] = useState<Board>(() =>
    mode === "Duel" ? initialBoard() : createEmptyBoard()
  );
  const [bScore, setBScore] = useState(0);
  const [bMoves, setBMoves] = useState(0);
  const [bMerges, setBMerges] = useState(0);
  const [bOver, setBOver] = useState(mode === "Duel" ? false : true);
  const [difficulty, setDifficulty] = useState<DifficultyMeta>(DIFFICULTIES[6]); // 7: Strategist
  const [botRunning, setBotRunning] = useState(true);
  const [botSpeed, setBotSpeed] = useState(6);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const botWasRunning = useRef(true);

  // Duel-save gating
  const botFinalScore = useRef<number | null>(null);
  const duelSavedRef = useRef<boolean>(false);

  // Input lock for merge animation
  const inputBusy = useRef(false);

  // **Race-proof** bot step guard
  const botBusy = useRef(false);

  const winner: "Player" | "Bot" | "" =
    pOver && !bOver ? "Bot" : bOver && !pOver ? "Player" : "";

  /* -------- Worker integration (+ fallbacks) -------- */
  const workerRef = useRef<Worker | null>(null);
  const reqSeq = useRef(0);

  // Robust worker init (Vite ?worker → URL fallback). If all fail, we’ll soft-fallback in askBotMove.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const WorkerCtor = (await import("./botWorker?worker")).default as {
          new (): Worker;
        };
        if (!cancelled) workerRef.current = new WorkerCtor();
      } catch (e1) {
        try {
          const w = new Worker(new URL("./botWorker.ts", import.meta.url), {
            type: "module",
          });
          if (!cancelled) workerRef.current = w;
        } catch (e2) {
          console.error("Bot worker failed to load.", e1, e2);
          workerRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
    };
  }, []);

  // Minimal biased fallback if worker can’t start (keeps the game playable)
  function fallbackBotMove(board: number[][]): Dir {
    const dirs: Dir[] = ["left", "up", "right", "down"];
    const legal = dirs.filter((d) => move(board as any, d).moved);
    for (const d of dirs)
      if (legal.includes(d) && Math.random() < 0.7) return d;
    return legal[0] ?? "left";
  }

  function askBotMove(
    board: number[][],
    score: number,
    level: number
  ): Promise<Dir> {
    const w = workerRef.current;
    if (!w) return Promise.resolve(fallbackBotMove(board));
    return new Promise((resolve) => {
      const id = (++reqSeq.current).toString(36);
      const onMsg = (e: MessageEvent) => {
        if (e.data?.id === id) {
          w.removeEventListener("message", onMsg as any);
          resolve(e.data.dir as Dir);
        }
      };
      w.addEventListener("message", onMsg as any);
      w.postMessage({ id, type: "move", board: board.flat(), score, level });
    });
  }

  /* -------- controls -------- */
  const resetSide = (who: "player" | "bot") => {
    if (who === "player") {
      setPBoard(initialBoard());
      setPScore(0);
      setPMoves(0);
      setPMerges(0);
      setPOver(false);
      setPStartAt(Date.now());
      setPMergedSet(new Set());
      duelSavedRef.current = false;
    } else if (mode === "Duel") {
      setBBoard(initialBoard());
      setBScore(0);
      setBMoves(0);
      setBMerges(0);
      setBOver(false);
      botFinalScore.current = null;
      duelSavedRef.current = false;
    }
  };
  const resetBoth = () => {
    resetSide("player");
    if (mode === "Duel") resetSide("bot");
  };

  const openSettings = () => {
    botWasRunning.current = botRunning;
    setBotRunning(false);
    setShowSettings(true);
  };
  const closeSettings = () => {
    setShowSettings(false);
    setBotRunning(botWasRunning.current);
  };

  const doPlayerMove = useCallback(
    (dir: Dir) => {
      if (pOver || inputBusy.current) return;
      const {
        board: nb,
        moved,
        scoreDelta,
        mergedPositions,
      } = move(pBoard, dir);
      if (!moved) return;
      inputBusy.current = true;

      const { board: withSpawn } = addRandomTile(nb);
      setPBoard(withSpawn);
      setPMergedSet(new Set(mergedPositions.map(([r, c]) => `${r}-${c}`)));
      setPScore((s) => s + scoreDelta);
      setPMoves((m) => m + 1);
      setPMerges((m) => m + mergedPositions.length);
      if (!anyMoves(withSpawn)) setPOver(true);

      setTimeout(() => {
        inputBusy.current = false;
        setPMergedSet(new Set());
      }, 110);
    },
    [pBoard, pOver]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
        a: "left",
        d: "right",
        w: "up",
        s: "down",
      };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        doPlayerMove(d);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doPlayerMove]);

  // Bot loop (race-proof + atomic)
  useIntervalSeq(
    async () => {
      if (
        screen !== "game" ||
        !botRunning ||
        bOver ||
        mode !== "Duel" ||
        showSettings
      )
        return;
      if (botBusy.current) return;
      botBusy.current = true;

      const dir = await askBotMove(bBoard, bScore, difficulty.level);

      setBBoard((prev) => {
        const {
          board: nb,
          moved,
          scoreDelta,
          mergedPositions,
        } = move(prev, dir);

        // If worker sent a non-moving dir: either there are no moves (true loss) or ignore
        if (!moved) {
          if (!validMoves(prev).length) setBOver(true);
          botBusy.current = false;
          return prev;
        }

        const { board: withSpawn } = addRandomTile(nb);
        setBScore((s) => s + scoreDelta);
        setBMoves((m) => m + 1);
        setBMerges((m) => m + mergedPositions.length);
        if (!anyMoves(withSpawn)) setBOver(true);

        botBusy.current = false;
        return withSpawn;
      });
    },
    screen === "game" &&
      botRunning &&
      !bOver &&
      mode === "Duel" &&
      !showSettings
      ? speedToDelay(botSpeed)
      : null
  );

  // Capture bot final score once (for duel save rule)
  useEffect(() => {
    if (mode !== "Duel") return;
    if (bOver && botFinalScore.current === null) {
      botFinalScore.current = bScore;
    }
  }, [bOver, bScore, mode]);

  // Save runs
  useEffect(() => {
    if (!activeProfile) return;

    // SOLO: save at finish
    if (mode === "Solo" && pOver) {
      const run: RunRecord = {
        date: Date.now(),
        mode: "Solo",
        score: pScore,
        moves: pMoves,
        merges: pMerges,
        maxTile: maxTile(pBoard),
        durationMs: Date.now() - pStartAt,
        outcome: "solo",
      };
      setProfiles((arr) => {
        const i = arr.findIndex((p) => p.id === activeProfile.id);
        if (i === -1) return arr;
        const next = arr.slice();
        next[i] = upsertRun(arr[i], run);
        saveProfiles(next);
        return next;
      });
    }

    // DUEL: save only if bot is out AND player eventually beats bot's final score, on player's finish
    if (
      shouldSaveDuelRun({
        mode,
        playerOver: pOver,
        playerScore: pScore,
        botFinalScore: botFinalScore.current,
        duelAlreadySaved: duelSavedRef.current,
      })
    ) {
      const run: RunRecord = {
        date: Date.now(),
        mode: "Duel",
        score: pScore,
        moves: pMoves,
        merges: pMerges,
        maxTile: maxTile(pBoard),
        durationMs: Date.now() - pStartAt,
        difficultyLevel: difficulty.level,
        outcome: "win",
        bot: {
          score: bScore,
          moves: bMoves,
          merges: bMerges,
          maxTile: maxTile(bBoard),
        },
      };
      duelSavedRef.current = true;
      setProfiles((arr) => {
        const i = arr.findIndex((p) => p.id === activeProfile.id);
        if (i === -1) return arr;
        const next = arr.slice();
        next[i] = upsertRun(arr[i], run);
        saveProfiles(next);
        return next;
      });
    }
  }, [pOver]);

  /* =========================
     Screens
     ========================= */

  function ProfilesScreen() {
    const [newName, setNewName] = useState("");
    const onCreate = () => {
      const name = newName.trim() || `Player ${profiles.length + 1}`;
      const id = cryptoRandomId();
      const prof: Profile = {
        id,
        name,
        createdAt: Date.now(),
        lastPlayedAt: Date.now(),
        runs: [],
        bestScore: 0,
        bestMaxTile: 0,
        bestBotBeaten: 0,
      };
      const next = [...profiles, prof];
      setProfiles(next);
      saveProfiles(next);
      setActiveId(id);
      saveActiveId(id);
      setNewName("");
    };
    const onDelete = (id: string) => {
      if (!confirm("Delete this profile and its local leaderboard entries?"))
        return;
      const next = profiles.filter((p) => p.id !== id);
      setProfiles(next);
      saveProfiles(next);
      if (activeId === id) {
        setActiveId(null);
        saveActiveId("");
      }
    };
    const setActive = (id: string) => {
      setActiveId(id);
      saveActiveId(id);
    };

    return (
      <div className="mx-auto max-w-3xl p-6 text-stone-900 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">Profiles</h1>
          <button
            type="button"
            onClick={() => setScreen("menu")}
            className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
          >
            Back
          </button>
        </div>
        <div className="rounded-3xl bg-white p-4 shadow border border-stone-200">
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            {profiles.map((p) => (
              <div
                key={p.id}
                className={`rounded-2xl p-3 border shadow-sm flex items-start justify-between ${
                  activeId === p.id ? "border-emerald-400" : "border-stone-200"
                }`}
              >
                <div>
                  <button
                    type="button"
                    onClick={() => setActive(p.id)}
                    className="text-left font-semibold hover:underline"
                  >
                    {p.name}
                  </button>
                  <div className="text-xs text-stone-500 mt-1">
                    Best bot beaten: {p.bestBotBeaten || "—"}
                  </div>
                </div>
                <div className="text-xs text-stone-500 flex items-center gap-2">
                  <span>
                    Best Score {p.bestScore} • Best Tile {p.bestMaxTile}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id)}
                    className="text-stone-500 hover:text-rose-600"
                    title="Delete profile"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New player name"
              className="px-3 py-2 rounded-xl border border-stone-300 flex-1"
            />
            <button
              type="button"
              onClick={onCreate}
              className="px-3 py-2 rounded-xl bg-stone-800 text-white"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  function MenuScreen() {
    return (
      <div className="mx-auto max-w-3xl p-6 text-stone-900 space-y-6">
        <h1 className="text-3xl font-extrabold tracking-tight">2048 Duel</h1>
        <p className="text-stone-600">
          Play classic 2048 or challenge a bot with 10 difficulty levels.
          Save your profile and climb the local leaderboard.
        </p>

        <div className="rounded-3xl bg-white p-4 shadow border border-stone-200 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setMode("Solo");
                setScreen("game");
                resetBoth();
              }}
              className="px-4 py-3 rounded-2xl bg-stone-800 text-white shadow hover:opacity-90"
            >
              Play Solo
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("Duel");
                setScreen("game");
                resetBoth();
              }}
              className="px-4 py-3 rounded-2xl bg-emerald-600 text-white shadow hover:opacity-90"
            >
              Duel vs Bot
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScreen("leaderboard")}
              className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
            >
              Leaderboard
            </button>
            <button
              type="button"
              onClick={() => setScreen("profiles")}
              className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
            >
              Profiles
            </button>
            <button
              type="button"
              onClick={openSettings}
              className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
            >
              Settings
            </button>
          </div>
        </div>

        <Tips />
      </div>
    );
  }

  function LeaderboardScreen() {
    type Row = RunRecord & { player: string };

    // best Solo per player (by score)
    const soloBest: Row[] = [];
    for (const p of profiles) {
      const soloRuns = p.runs.filter((r) => r.mode === "Solo");
      if (!soloRuns.length) continue;
      const best = soloRuns.slice().sort((a, b) => b.score - a.score)[0];
      soloBest.push({ ...best, player: p.name });
    }
    soloBest.sort((a, b) => b.score - a.score);

    // best Duel per player (wins only)
    const duelBest: Row[] = [];
    for (const p of profiles) {
      const duelWins = p.runs.filter(
        (r) => r.mode === "Duel" && r.outcome === "win"
      );
      if (!duelWins.length) continue;
      const best = duelWins.slice().sort((a, b) => b.score - a.score)[0];
      duelBest.push({ ...best, player: p.name });
    }
    duelBest.sort((a, b) => b.score - a.score);

    function SoloTable({ rows }: { rows: Row[] }) {
      return (
        <div className="rounded-3xl bg-white p-4 shadow border border-stone-200">
          <h3 className="font-semibold mb-3">Solo — Best Score per Player</h3>
          {rows.length === 0 ? (
            <p className="text-stone-500 text-sm">No runs yet.</p>
          ) : (
            <div className="grid grid-cols-12 text-xs font-semibold text-stone-600 pb-2 border-b">
              <div className="col-span-3">Player</div>
              <div className="col-span-2">Score</div>
              <div className="col-span-2">Best Tile</div>
              <div className="col-span-3">Time</div>
              <div className="col-span-2">When</div>
              {rows.map((r, i) => (
                <div key={i} className="contents text-sm">
                  <div className="col-span-3 py-2 font-medium">{r.player}</div>
                  <div className="col-span-2 py-2">{r.score}</div>
                  <div className="col-span-2 py-2">{r.maxTile}</div>
                  <div className="col-span-3 py-2">
                    {formatTime(r.durationMs)}
                  </div>
                  <div className="col-span-2 py-2 text-stone-500">
                    {new Date(r.date).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    function DuelTable({ rows }: { rows: Row[] }) {
      return (
        <div className="rounded-3xl bg-white p-4 shadow border border-stone-200">
          <h3 className="font-semibold mb-3">
            Duel — Best Score per Player (Wins)
          </h3>
          {rows.length === 0 ? (
            <p className="text-stone-500 text-sm">No wins recorded yet.</p>
          ) : (
            <div className="grid grid-cols-12 text-xs font-semibold text-stone-600 pb-2 border-b">
              <div className="col-span-3">Player</div>
              <div className="col-span-2">Score</div>
              <div className="col-span-2">Best Tile</div>
              <div className="col-span-2">Bot Level</div>
              <div className="col-span-3">When</div>
              {rows.map((r, i) => (
                <div key={i} className="contents text-sm">
                  <div className="col-span-3 py-2 font-medium">{r.player}</div>
                  <div className="col-span-2 py-2">{r.score}</div>
                  <div className="col-span-2 py-2">{r.maxTile}</div>
                  <div className="col-span-2 py-2">
                    {r.difficultyLevel ?? "—"}
                  </div>
                  <div className="col-span-3 py-2 text-stone-500">
                    {new Date(r.date).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-4xl p-6 text-stone-900 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Leaderboard
          </h1>
          <button
            type="button"
            onClick={() => setScreen("menu")}
            className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
          >
            Back
          </button>
        </div>
        <SoloTable rows={soloBest} />
        <DuelTable rows={duelBest} />
      </div>
    );
  }

  function GameScreen() {
    const mergedBot = useMemo(() => new Set<string>(), [bBoard]); // no bounce for bot merges

    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6 lg:p-8 text-stone-900">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            2048 {mode === "Solo" ? "Solo" : "Duel"}
          </h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openSettings}
              className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setScreen("menu")}
              className="px-3 py-2 rounded-xl bg-stone-200 hover:bg-stone-300"
            >
              Menu
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatBadge label="Score" value={pScore} />
          {settings.showMoves && <StatBadge label="Moves" value={pMoves} />}
          {settings.showMerges && <StatBadge label="Merges" value={pMerges} />}
          <StatBadge label="Best Tile" value={maxTile(pBoard)} />
          {settings.showTime && (
            <StatBadge label="Time" value={formatTime(Date.now() - pStartAt)} />
          )}
        </div>

        <div className="rounded-3xl bg-stone-100 p-4 md:p-5 shadow-sm">
          <div
            className={
              mode === "Duel"
                ? "grid md:grid-cols-[1fr_320px] gap-6 items-start"
                : "grid grid-cols-1 gap-6 items-start"
            }
          >
            <div
              className={
                mode === "Duel"
                  ? "grid grid-cols-1 md:grid-cols-2 gap-6"
                  : "grid grid-cols-1 gap-6"
              }
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold">You</h2>
                  <div className="text-stone-500 text-sm">
                    {pOver ? (
                      <span className="text-rose-600 font-semibold">
                        Game Over
                      </span>
                    ) : (
                      "Arrow keys / WASD"
                    )}
                  </div>
                </div>
                <BoardView board={pBoard} mergedCells={pMergedSet} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resetSide("player")}
                    className="px-3 py-2 rounded-xl bg-stone-800 text-white shadow hover:opacity-90"
                  >
                    New Game
                  </button>
                </div>
              </div>

              {mode === "Duel" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold flex items-center gap-2">
                      Bot
                      <span className="text-xs px-2 py-1 rounded-full bg-stone-100 border">
                        {difficulty.level} — {difficulty.name}
                      </span>
                    </h2>
                    <div className="text-sm text-stone-500">
                      {bOver ? (
                        <span className="text-rose-600 font-semibold">
                          Bot Lost
                        </span>
                      ) : botRunning ? (
                        "Running…"
                      ) : (
                        "Paused"
                      )}
                    </div>
                  </div>
                  <BoardView board={bBoard} mergedCells={mergedBot} />
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      type="button"
                      onClick={() => setBotRunning((b) => !b)}
                      className="px-3 py-2 rounded-xl bg-stone-800 text-white shadow hover:opacity-90"
                    >
                      {botRunning ? "Pause Bot" : "Resume Bot"}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetSide("bot")}
                      className="px-3 py-2 rounded-xl bg-stone-700 text-white shadow hover:opacity-90"
                    >
                      Reset Bot
                    </button>
                    <label className="text-sm text-stone-600 ml-1">Speed</label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={botSpeed}
                      onMouseDown={() => {
                        botWasRunning.current = botRunning;
                        setBotRunning(false);
                      }}
                      onMouseUp={() => setBotRunning(botWasRunning.current)}
                      onChange={(e) => setBotSpeed(parseInt(e.target.value))}
                    />
                    <span className="text-xs text-stone-600">
                      {botSpeed}/10
                    </span>
                  </div>
                </div>
              )}
            </div>

            {mode === "Duel" && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-white p-4 shadow border border-stone-200">
                  <h3 className="font-semibold mb-2">Match Controls</h3>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={resetBoth}
                      className="px-3 py-2 rounded-xl bg-emerald-600 text-white shadow hover:opacity-90"
                    >
                      New Match (Both)
                    </button>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-sm">Bot Level</label>
                      <select
                        className="px-2 py-1 rounded-md border border-stone-300 bg-white"
                        value={difficulty.level}
                        onChange={(e) =>
                          setDifficulty(
                            DIFFICULTIES[parseInt(e.target.value) - 1]
                          )
                        }
                      >
                        {DIFFICULTIES.map((d) => (
                          <option key={d.level} value={d.level}>
                            {d.level} — {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow border border-stone-200">
                  <h3 className="font-semibold mb-2">Bot Stats</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <StatBadge label="Score" value={bScore} />
                    <StatBadge label="Best Tile" value={maxTile(bBoard)} />
                    {settings.showMoves && (
                      <StatBadge label="Moves" value={bMoves} />
                    )}
                    {settings.showMerges && (
                      <StatBadge label="Merges" value={bMerges} />
                    )}
                    {settings.showEmptyCells && (
                      <StatBadge
                        label="Empty Cells"
                        value={countEmpty(bBoard)}
                      />
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow border border-stone-200">
                  <h3 className="font-semibold mb-2">Win Rule</h3>
                  <p className="text-sm text-stone-600">
                    Your duel win is recorded only if the bot is out and your
                    final score beats the bot’s final score.{" "}
                    {winner && (
                      <span className="font-medium text-stone-800">
                        Currently:{" "}
                        {winner === "Player"
                          ? "Bot lost — keep playing!"
                          : "Bot still running"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function SettingsDrawer() {
    return (
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30"
            onClick={closeSettings}
          >
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              className="w-[min(680px,95vw)] rounded-3xl bg-white border border-stone-200 shadow-xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">Settings</h3>
                <button
                  type="button"
                  onClick={closeSettings}
                  className="text-stone-500 hover:text-stone-800"
                >
                  ✕
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl border p-4">
                  <h4 className="font-medium mb-2">Gameplay</h4>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-stone-600">Bot Speed</span>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={botSpeed}
                      onMouseDown={() => {
                        botWasRunning.current = botRunning;
                        setBotRunning(false);
                      }}
                      onMouseUp={() => setBotRunning(botWasRunning.current)}
                      onChange={(e) => setBotSpeed(parseInt(e.target.value))}
                    />
                    <span className="text-stone-800 text-xs">
                      {botSpeed}/10
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-sm">
                    <span className="text-stone-600">Bot Level</span>
                    <select
                      value={difficulty.level}
                      onChange={(e) =>
                        setDifficulty(
                          DIFFICULTIES[parseInt(e.target.value) - 1]
                        )
                      }
                      className="px-2 py-1 rounded-md border border-stone-300"
                    >
                      {DIFFICULTIES.map((d) => (
                        <option key={d.level} value={d.level}>
                          {d.level} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="rounded-2xl border p-4">
                  <h4 className="font-medium mb-2">Stats Visibility</h4>
                  {(
                    [
                      "showMoves",
                      "showMerges",
                      "showTime",
                      "showEmptyCells",
                    ] as (keyof Settings)[]
                  ).map((k) => (
                    <label
                      key={k}
                      className="flex items-center gap-2 mb-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={settings[k] as boolean}
                        onChange={(e) =>
                          setSettings((s) => ({ ...s, [k]: e.target.checked }))
                        }
                      />
                      {k === "showMoves"
                        ? "Moves"
                        : k === "showMerges"
                        ? "Merges"
                        : k === "showTime"
                        ? "Time"
                        : "Empty Cells (bot)"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-3 text-right">
                <button
                  type="button"
                  onClick={closeSettings}
                  className="px-3 py-2 rounded-xl bg-stone-800 text-white"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  /* -------- Render -------- */
  return (
    <div>
      {screen === "menu" && <MenuScreen />}
      {screen === "leaderboard" && <LeaderboardScreen />}
      {screen === "profiles" && <ProfilesScreen />}
      {screen === "game" && <GameScreen />}
      <SettingsDrawer />
    </div>
  );
}
