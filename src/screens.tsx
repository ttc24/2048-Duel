import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { Board } from "./types";

const TILE_CLASSES: Record<number, string> = {
  0: "bg-stone-200",
  2: "bg-amber-100 text-stone-800",
  4: "bg-amber-200 text-stone-800",
  8: "bg-orange-300 text-white",
  16: "bg-orange-400 text-white",
  32: "bg-orange-500 text-white",
  64: "bg-orange-600 text-white",
  128: "bg-yellow-400 text-white",
  256: "bg-yellow-500 text-white",
  512: "bg-yellow-600 text-white",
  1024: "bg-lime-500 text-white",
  2048: "bg-emerald-500 text-white",
};

export function StatBadge({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-stone-200 px-3 py-2 text-sm font-medium shadow">
      <span className="text-stone-500 mr-2">{label}</span>
      <span className="text-stone-900">{value}</span>
    </div>
  );
}

export function BoardView({
  board,
  mergedCells,
}: {
  board: Board;
  mergedCells: Set<string>;
}) {
  return (
    <div className="w-full max-w-[540px] mx-auto">
      <div className="grid grid-cols-4 gap-2 p-3 rounded-3xl bg-stone-300 shadow-inner">
        {board.map((row, r) =>
          row.map((v, c) => {
            const key = `${r}-${c}`;
            const active = mergedCells.has(key);
            const cls = TILE_CLASSES[v] || "bg-emerald-600 text-white";
            return (
              <motion.div
                key={key}
                animate={{ scale: active ? 1.06 : 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 24 }}
                className={`aspect-square w-full rounded-2xl font-extrabold flex items-center justify-center shadow ${cls}`}
              >
                {v !== 0 ? (
                  <span className="text-xl md:text-2xl lg:text-3xl select-none">{v}</span>
                ) : (
                  <span className="opacity-0">0</span>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function Tips() {
  return (
    <div className="rounded-2xl bg-white p-4 shadow border border-stone-200">
      <h3 className="font-semibold mb-2">Tips</h3>
      <ul className="text-sm text-stone-600 space-y-1 list-disc pl-5">
        <li>Keep your highest tile in a corner (usually top-left).</li>
        <li>Avoid moving down/right randomly once your corner is set.</li>
        <li>In Duel, pace your risk based on bot level and score.</li>
      </ul>
    </div>
  );
}
