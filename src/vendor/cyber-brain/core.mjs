// cyber-brain core: the pure formats of SPEC.md, no I/O. Shared by
// scripts/brain.mjs and the MCP bridge (mcp/lib/core.mjs is a verified copy).

export const LIMITS = {
  "identity/SOUL.md": 1500,
  "identity/USER.md": 2000,
  "identity/NOW.md": 1500,
  "memory/loops.md": 15000,
};
export const AGENT_MEMORY_LIMIT = 8000;
export const SUMMARY_MAX = 180;
export const FACT_KEYS = ["source", "since", "until", "was", "confidence"];
export const TRANSIT_KINDS = ["fact", "loop", "decision", "block", "observation", "skill"];
export const LOOP_STATUS = ["open", "waiting-user", "closed"];
export const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "API key (sk-)"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
];

// ---------- frontmatter (the YAML subset the kit writes) ----------

export function scalar(v) {
  const t = v.trim();
  if (t === "") return "";
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z0-9_"'.-]+):\s*(.*)$/.exec(line);
    if (top && !line.startsWith(" ")) {
      key = top[1].replace(/^["']|["']$/g, "");
      data[key] = top[2] === "" ? null : scalar(top[2]);
      continue;
    }
    if (!key) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(scalar(item[1]));
      continue;
    }
    const sub = /^\s+([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (sub) {
      if (data[key] === null || typeof data[key] !== "object" || Array.isArray(data[key])) data[key] = {};
      data[key][sub[1]] = scalar(sub[2]);
    }
  }
  return { data, body: text.slice(m[0].length), hasFrontmatter: true };
}

// ---------- fact lines ----------

export const FACT_RE = /^(\s*[-*]\s+)(.*?)\s*\[(source:[^\]]*)\]\s*$/;

export function parseFact(line) {
  const m = FACT_RE.exec(line);
  if (!m) return null;
  const meta = {};
  const order = [];
  for (const part of m[3].split(/;\s*/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(part.trim());
    if (!kv) return { text: m[2], meta, order, error: `bad key segment "${part.trim()}"` };
    meta[kv[1]] = kv[2].trim();
    order.push(kv[1]);
  }
  let error = null;
  const unknown = order.filter((k) => !FACT_KEYS.includes(k));
  if (unknown.length) error = `unknown key ${unknown.join(", ")}`;
  const idx = order.map((k) => FACT_KEYS.indexOf(k));
  if (!error && idx.some((v, i) => i > 0 && v < idx[i - 1])) error = "keys out of order (source, since, until, was, confidence)";
  for (const d of ["since", "until"]) if (!error && meta[d] && !/^\d{4}-\d{2}-\d{2}$/.test(meta[d])) error = `${d} is not YYYY-MM-DD`;
  return { text: m[2], meta, order, error };
}

export function trueOn(fact, date) {
  const { since, until } = fact.meta;
  if (since && since > date) return false;
  if (until && until <= date) return false;
  return true;
}

// ---------- loops and runs ----------

export function parseLoops(text) {
  const loops = [];
  const parts = text.split(/^## (?=loop-)/m).slice(1);
  for (const p of parts) {
    const lines = p.split(/\r?\n/);
    const loop = { id: lines[0].trim(), fields: {}, stateLines: 0 };
    for (const l of lines.slice(1)) {
      const kv = /^- ([a-z-]+):\s*(.*)$/.exec(l);
      if (kv) {
        if (kv[1] === "state") loop.stateLines++;
        loop.fields[kv[1]] = kv[2].trim();
      }
    }
    loops.push(loop);
  }
  return loops;
}

export function parseRuns(text) {
  const runs = [];
  const parts = text.split(/^## (?=\d{4}-\d{2}-\d{2}T)/m).slice(1);
  for (const p of parts) {
    const lines = p.split(/\r?\n/);
    const run = { header: lines[0].trim(), fields: {}, writes: [] };
    for (const l of lines.slice(1)) {
      const kv = /^- ([a-z]+):\s*(.*)$/.exec(l);
      if (!kv) continue;
      if (kv[1] === "write") run.writes.push(kv[2]);
      else run.fields[kv[1]] = kv[2].trim();
    }
    runs.push(run);
  }
  return runs;
}


// ---------- formatters (the only place the line formats are written) ----------

export const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export function slugify(s, max = 48) {
  return oneLine(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "item";
}

/** `- <fact> [source: ...; since: ...; until: ...; was: ...; confidence: ...]` */
export function formatFact(text, meta) {
  const parts = [];
  for (const k of FACT_KEYS) if (meta[k]) parts.push(`${k}: ${oneLine(meta[k])}`);
  return `- ${oneLine(text)} [${parts.join("; ")}]`;
}

/** Close a bracketed fact line: add `until:` and keep everything else. */
export function closeFactLine(line, until) {
  const f = parseFact(line);
  if (!f || f.error) return null;
  return formatFact(f.text, { ...f.meta, until });
}

export const formatTransit = (kind, text, target, source, since, was) =>
  `- [${kind}] ${oneLine(text)} -> ${oneLine(target || "?")} [source: ${oneLine(source)}; since: ${since}${was ? `; was: ${oneLine(was)}` : ""}]`;

const TRANSIT_RE = /^\s*- \[([a-z]+)\] (.+?) -> (.+?) \[(source:[^\]]*)\]\s*$/;

/** Parse a transit entry into { kind, text, target, meta } or null. */
export function parseTransit(line) {
  const m = TRANSIT_RE.exec(line);
  if (!m) return null;
  const f = parseFact(`- x [${m[4]}]`);
  return { kind: m[1], text: m[2], target: m[3].trim(), meta: f ? f.meta : {} };
}

export function formatLoop({ id, title, opened, resurface, status = "open", owner, state, context }) {
  const lines = [`## ${id}`, `- title: ${oneLine(title)}`, `- opened: ${opened}`];
  if (resurface) lines.push(`- resurface: ${resurface}`);
  lines.push(`- status: ${status}`);
  if (owner) lines.push(`- owner: ${oneLine(owner)}`);
  lines.push(`- state: ${oneLine(state || "open")}`);
  if (context) lines.push("", String(context).trim());
  return lines.join("\n");
}

const MONTHS = {
  jan: 1, january: 1, gen: 1, gennaio: 1, feb: 2, february: 2, febbraio: 2, mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, aprile: 4, may: 5, mag: 5, maggio: 5, jun: 6, june: 6, giu: 6, giugno: 6,
  jul: 7, july: 7, lug: 7, luglio: 7, aug: 8, august: 8, ago: 8, agosto: 8, sep: 9, sept: 9, september: 9,
  set: 9, settembre: 9, oct: 10, october: 10, ott: 10, ottobre: 10, nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, dic: 12, dicembre: 12,
};
const pad = (n) => String(n).padStart(2, "0");

/**
 * Resolve a date the user gave into YYYY-MM-DD. A full date is returned as is.
 * A day and month without a year is the next occurrence on or after `today`
 * (deadlines), or with `past: true` the last occurrence on or before it (when
 * something happened). Returns { date, assumedYear } or null.
 */
export function resolveDate(text, today, { past = false } = {}) {
  const t = oneLine(text).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { date: t, assumedYear: false };
  let day, month, year;
  if ((m = /^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/.exec(t))) [day, month, year] = [Number(m[1]), MONTHS[m[2]], m[3]];
  else if ((m = /^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(t))) [day, month, year] = [Number(m[2]), MONTHS[m[1]], m[3]];
  else if ((m = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?$/.exec(t))) [day, month, year] = [Number(m[1]), Number(m[2]), m[3]];
  else if ((m = /^(?:end of|fine(?: di)?)\s+([a-z]+)(?:\s+(\d{4}))?$/.exec(t)) && MONTHS[m[1]]) {
    month = MONTHS[m[1]]; year = m[2];
    const y0 = Number(year || today.slice(0, 4));
    day = new Date(Date.UTC(y0, month, 0)).getUTCDate();
  }
  else return null;
  if (!month || month > 12 || day < 1 || day > 31) return null;
  if (year) return { date: `${year}-${pad(month)}-${pad(day)}`, assumedYear: false };
  let y = Number(today.slice(0, 4));
  if (!past && `${y}-${pad(month)}-${pad(day)}` < today) y++;
  if (past && `${y}-${pad(month)}-${pad(day)}` > today) y--;
  return { date: `${y}-${pad(month)}-${pad(day)}`, assumedYear: true };
}
