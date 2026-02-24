import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addRandomTile,
  anyMoves,
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
import { AppScreens } from "./AppScreens";
import { DIFFICULTIES, formatTime, speedToDelay } from "./app-constants";
import { fallbackBotMove } from "./bot";
import { buildProfile, deleteProfileState } from "./profile-lifecycle";
import type { Board, DifficultyMeta, Dir, Profile, RunRecord, Screen, Settings } from "./types";

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

  const [pBoard, setPBoard] = useState<Board>(() => initialBoard());
  const [pScore, setPScore] = useState(0);
  const [pMoves, setPMoves] = useState(0);
  const [pMerges, setPMerges] = useState(0);
  const [pOver, setPOver] = useState(false);
  const [pStartAt, setPStartAt] = useState<number>(() => Date.now());
  const [pMergedSet, setPMergedSet] = useState<Set<string>>(new Set());

  const [bBoard, setBBoard] = useState<Board>(() => (mode === "Duel" ? initialBoard() : createEmptyBoard()));
  const [bScore, setBScore] = useState(0);
  const [bMoves, setBMoves] = useState(0);
  const [bMerges, setBMerges] = useState(0);
  const [bOver, setBOver] = useState(mode === "Duel" ? false : true);
  const [difficulty, setDifficulty] = useState<DifficultyMeta>(DIFFICULTIES[6]);
  const [botRunning, setBotRunning] = useState(true);
  const [botSpeed, setBotSpeed] = useState(6);

  const [showSettings, setShowSettings] = useState(false);
  const botWasRunning = useRef(true);
  const botFinalScore = useRef<number | null>(null);
  const duelSavedRef = useRef<boolean>(false);
  const inputBusy = useRef(false);
  const botBusy = useRef(false);

  const winner: "Player" | "Bot" | "" = pOver && !bOver ? "Bot" : bOver && !pOver ? "Player" : "";

  const workerRef = useRef<Worker | null>(null);
  const reqSeq = useRef(0);
  const pendingBotRequests = useRef(new Map<string, () => void>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const WorkerCtor = (await import("./botWorker?worker")).default as { new (): Worker };
        if (!cancelled) workerRef.current = new WorkerCtor();
      } catch {
        workerRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      pendingBotRequests.current.forEach((resolveFallback) => resolveFallback());
      pendingBotRequests.current.clear();
      workerRef.current?.terminate();
    };
  }, []);

  function askBotMove(board: number[][], score: number, level: number): Promise<Dir> {
    const w = workerRef.current;
    if (!w) return Promise.resolve(fallbackBotMove(board));
    return new Promise((resolve) => {
      const id = (++reqSeq.current).toString(36);
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(fallbackBotMove(board));
        }
      }, 300);

      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        pendingBotRequests.current.delete(id);
        w.removeEventListener("message", onMsg as EventListener);
        w.removeEventListener("error", onErr as EventListener);
        w.removeEventListener("messageerror", onErr as EventListener);
      };

      const onMsg = (e: MessageEvent) => {
        if (e.data?.id === id) {
          cleanup();
          resolve(e.data.dir as Dir);
        }
      };

      const onErr = () => {
        cleanup();
        resolve(fallbackBotMove(board));
      };

      pendingBotRequests.current.set(id, onErr);
      w.addEventListener("message", onMsg as EventListener);
      w.addEventListener("error", onErr as EventListener);
      w.addEventListener("messageerror", onErr as EventListener);
      try {
        w.postMessage({ id, type: "move", board: board.flat(), score, level });
      } catch {
        onErr();
      }
    });
  }

  const resetSide = (who: "player" | "bot") => {
    if (who === "player") {
      setPBoard(initialBoard());
      setPScore(0); setPMoves(0); setPMerges(0); setPOver(false); setPStartAt(Date.now()); setPMergedSet(new Set());
      duelSavedRef.current = false;
    } else if (mode === "Duel") {
      setBBoard(initialBoard());
      setBScore(0); setBMoves(0); setBMerges(0); setBOver(false);
      botFinalScore.current = null; duelSavedRef.current = false;
    }
  };
  const resetBoth = () => {
    resetSide("player");
    if (mode === "Duel") resetSide("bot");
  };

  const openSettings = () => { botWasRunning.current = botRunning; setBotRunning(false); setShowSettings(true); };
  const closeSettings = () => { setShowSettings(false); setBotRunning(botWasRunning.current); };

  const doPlayerMove = useCallback((dir: Dir) => {
    if (pOver || inputBusy.current) return;
    const { board: nb, moved, scoreDelta, mergedPositions } = move(pBoard, dir);
    if (!moved) return;
    inputBusy.current = true;
    const { board: withSpawn } = addRandomTile(nb);
    setPBoard(withSpawn);
    setPMergedSet(new Set(mergedPositions.map(([r, c]) => `${r}-${c}`)));
    setPScore((s) => s + scoreDelta);
    setPMoves((m) => m + 1);
    setPMerges((m) => m + mergedPositions.length);
    if (!anyMoves(withSpawn)) setPOver(true);
    setTimeout(() => { inputBusy.current = false; setPMergedSet(new Set()); }, 110);
  }, [pBoard, pOver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", a: "left", d: "right", w: "up", s: "down" };
      const d = map[e.key];
      if (d) { e.preventDefault(); doPlayerMove(d); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doPlayerMove]);

  useIntervalSeq(async () => {
    if (screen !== "game" || !botRunning || bOver || mode !== "Duel" || showSettings) return;
    if (botBusy.current) return;
    botBusy.current = true;
    try {
      const dir = await askBotMove(bBoard, bScore, difficulty.level);
      setBBoard((prev) => {
        const { board: nb, moved, scoreDelta, mergedPositions } = move(prev, dir);
        if (!moved) {
          if (!validMoves(prev).length) setBOver(true);
          return prev;
        }
        const { board: withSpawn } = addRandomTile(nb);
        setBScore((s) => s + scoreDelta);
        setBMoves((m) => m + 1);
        setBMerges((m) => m + mergedPositions.length);
        if (!anyMoves(withSpawn)) setBOver(true);
        return withSpawn;
      });
    } finally {
      botBusy.current = false;
    }
  }, screen === "game" && botRunning && !bOver && mode === "Duel" && !showSettings ? speedToDelay(botSpeed) : null);

  useEffect(() => {
    if (mode !== "Duel") return;
    if (bOver && botFinalScore.current === null) botFinalScore.current = bScore;
  }, [bOver, bScore, mode]);

  useEffect(() => {
    if (!activeProfile) return;
    if (mode === "Solo" && pOver) {
      const run: RunRecord = { date: Date.now(), mode: "Solo", score: pScore, moves: pMoves, merges: pMerges, maxTile: maxTile(pBoard), durationMs: Date.now() - pStartAt, outcome: "solo" };
      setProfiles((arr) => {
        const i = arr.findIndex((p) => p.id === activeProfile.id); if (i === -1) return arr;
        const next = arr.slice(); next[i] = upsertRun(arr[i], run); saveProfiles(next); return next;
      });
    }
    if (shouldSaveDuelRun({ mode, playerOver: pOver, playerScore: pScore, botFinalScore: botFinalScore.current, duelAlreadySaved: duelSavedRef.current })) {
      const run: RunRecord = {
        date: Date.now(), mode: "Duel", score: pScore, moves: pMoves, merges: pMerges, maxTile: maxTile(pBoard), durationMs: Date.now() - pStartAt,
        difficultyLevel: difficulty.level, outcome: "win",
        bot: { score: bScore, moves: bMoves, merges: bMerges, maxTile: maxTile(bBoard) },
      };
      duelSavedRef.current = true;
      setProfiles((arr) => {
        const i = arr.findIndex((p) => p.id === activeProfile.id); if (i === -1) return arr;
        const next = arr.slice(); next[i] = upsertRun(arr[i], run); saveProfiles(next); return next;
      });
    }
  }, [pOver]);

  const pElapsed = useMemo(() => formatTime(Date.now() - pStartAt), [pOver, pStartAt, pScore, pMoves]);

  const createProfile = (newName: string) => {
    const id = cryptoRandomId();
    const prof = buildProfile({ newName, profilesCount: profiles.length, id, now: Date.now() });
    const next = [...profiles, prof];
    setProfiles(next);
    saveProfiles(next);
    setActiveId(id);
    saveActiveId(id);
  };

  const deleteProfile = (id: string) => {
    const next = deleteProfileState({ profiles, activeId, deleteId: id });
    setProfiles(next.profiles);
    saveProfiles(next.profiles);
    setActiveId(next.activeId);
    saveActiveId(next.activeId ?? "");
  };

  const setActiveProfile = (id: string) => {
    setActiveId(id);
    saveActiveId(id);
  };

  return (
    <AppScreens
      screen={screen}
      setScreen={setScreen}
      mode={mode}
      setMode={setMode}
      activeProfile={activeProfile}
      profiles={profiles}
      activeId={activeId}
      onCreateProfile={createProfile}
      onDeleteProfile={deleteProfile}
      onSetActiveProfile={setActiveProfile}
      onStartSolo={() => { setMode("Solo"); setScreen("game"); resetBoth(); }}
      onStartDuel={() => { setMode("Duel"); setScreen("game"); resetBoth(); }}
      pBoard={pBoard}
      pMergedSet={pMergedSet}
      pScore={pScore}
      pMoves={pMoves}
      pMerges={pMerges}
      pOver={pOver}
      pElapsed={pElapsed}
      bBoard={bBoard}
      bScore={bScore}
      bMoves={bMoves}
      bMerges={bMerges}
      bOver={bOver}
      winner={winner}
      difficulty={difficulty}
      difficulties={DIFFICULTIES}
      setDifficulty={setDifficulty}
      botRunning={botRunning}
      setBotRunning={setBotRunning}
      botSpeed={botSpeed}
      setBotSpeed={setBotSpeed}
      settings={settings}
      setSettings={setSettings}
      showSettings={showSettings}
      openSettings={openSettings}
      closeSettings={closeSettings}
      resetSide={resetSide}
    />
  );
}
