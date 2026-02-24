import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (full.endsWith('.js')) {
      const src = readFileSync(full, 'utf8');
      const next = src.replace(/from\s+"(\.\.?\/[^".]+)"/g, 'from "$1.js"');
      if (next !== src) writeFileSync(full, next);
    }
  }
}

walk('.tmp-tests');
