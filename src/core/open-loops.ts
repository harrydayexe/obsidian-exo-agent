/**
 * Open loops, pure logic (no Obsidian imports). The file is the cyber-brain
 * `memory/loops.md` (../cyber-brain/SPEC.md section 4.3).
 *
 * A "loop" is a durable open thread the user asked to be reminded about later:
 * a follow-up, a promise, a thing to circle back on. A loop has a lifecycle: it
 * opens, optionally carries a tickler ("resurface") date, may wait on the user,
 * and closes with an append-only outcome note. Closing NEVER deletes the entry.
 *
 * On-disk shape, one block per entry:
 *
 *   ## loop-<slug>
 *   - title: <title>
 *   - opened: <YYYY-MM-DD>
 *   - resurface: <YYYY-MM-DD>   (tickler date; line omitted when open-ended)
 *   - status: open|waiting-user|closed
 *   - owner: <who must act>     (line omitted when unset)
 *   - state: <one line, replaced, never appended>
 *   - tags: tag1, tag2          (Exo extra; line omitted when no tags)
 *
 *   <verbatim note, may be multi-line markdown; the outcome is appended here
 *    on close, the opening context is never overwritten>
 *
 * The block is written by the kit's own `formatLoop` (vendor/cyber-brain), so
 * Exo and the kit never disagree on field order. `parseLoopsFile` tolerates
 * arbitrary junk between blocks (a human may hand-edit the file) and never
 * throws: garbage lines are skipped, not fatal.
 */
import { LOOP_STATUS, formatLoop as formatKitLoop, slugify, type LoopStatus } from "../vendor/cyber-brain/core.mjs";

export type { LoopStatus };

export interface LoopEntry {
  /** Stable id `loop-<slug>` (see {@link uniqueLoopId}). */
  id: string;
  title: string;
  /** The opening context, stored verbatim. Outcome text is appended (never overwritten) on close. */
  note: string;
  /** Creation time, epoch milliseconds (day precision on disk). */
  openedAt: number;
  /**
   * How the source wrote `opened:` when it is not the canonical `YYYY-MM-DD` of `openedAt`
   * (a full ISO timestamp, free text). `formatLoop` writes it back verbatim.
   * `null` = the source had no `opened:` line, so none is written. Absent = the loop
   * was created by code and gets a date line.
   */
  openedRaw?: string | null;
  /** Unknown `- key: value` metadata lines, kept verbatim so a rewrite never drops them. */
  extraMeta?: string[];
  /** Tickler date the loop should resurface on, `YYYY-MM-DD` (local date). Omitted = due immediately. */
  resurface?: string;
  status: LoopStatus;
  /** Who must act: `user` or an agent. Omitted = unset. */
  owner?: string;
  /** One line, replaced on every change; on close it carries the outcome. */
  state?: string;
  tags?: string[];
}

/** Block header, e.g. `## loop-1720000000000` or a hand-written slug `## loop-2026-10-03-turno-init`. No `g` flag: safe for `.test`. */
const HEADER = /^##\s+(loop-[\w-]+)\s*$/;
/** A metadata line inside a block, e.g. `- title: Follow up with Marco`. */
const META = /^-\s+([\w-]+):\s*(.*)$/;

/** `YYYY-MM-DD` (UTC) of an instant: what `opened:` holds. */
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The `state:` of a loop whose source had none. */
const defaultState = (status: LoopStatus): string => (status === "closed" ? "closed" : status === "waiting-user" ? "waiting for the user" : "open");

/** Render one entry to its canonical on-disk block (no trailing newline). */
export function formatLoop(e: LoopEntry): string {
  const lines = formatKitLoop({
    id: e.id,
    title: e.title,
    opened: e.openedRaw ?? dayOf(e.openedAt),
    resurface: e.resurface,
    status: e.status,
    owner: e.owner,
    state: e.state ?? defaultState(e.status),
    context: e.note,
  }).split("\n");
  if (e.openedRaw === null) lines.splice(lines.findIndex((l) => l.startsWith("- opened:")), 1);
  const extra = [...(e.tags && e.tags.length ? [`- tags: ${e.tags.join(", ")}`] : []), ...(e.extraMeta ?? [])];
  lines.splice(lines.findIndex((l) => l.startsWith("- state:")) + 1, 0, ...extra);
  return lines.join("\n");
}

/** A new `loops.md`: the description line every system file carries, then the loops. */
export const LOOPS_FILE_HEADER = `---
description: Open loops: commitments and follow-ups with an owner and a one-line state. Open to see what is pending.
sensitivity: personal
---
# Loops
`;

/** The source text of each loop block, by id (block = header line up to the next header). */
function blocksById(content: string): Map<string, string> {
  const heads = [...content.matchAll(/^##\s+(loop-[\w-]+)\s*$/gm)];
  const out = new Map<string, string>();
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : content.length;
    out.set(h[1], content.slice(h.index, end).replace(/\s+$/, ""));
  });
  return out;
}

/** The file with `entries` as its loops. What precedes the first loop
 *  (frontmatter, heading) stays as it was, and so does every block whose entry
 *  was not changed: only a new or changed loop is written in the kit's shape. */
export function writeLoops(content: string, entries: readonly LoopEntry[]): string {
  const first = /^##\s+loop-/m.exec(content);
  const preamble = first ? content.slice(0, first.index) : content.replace(/\s*$/, "\n\n");
  const source = blocksById(content);
  const blocks = entries.map((e) => {
    const prior = source.get(e.id);
    const same = prior !== undefined && JSON.stringify(parseLoopsFile(prior)[0]) === JSON.stringify(e);
    return same ? prior : formatLoop(e);
  });
  return `${preamble}${blocks.join("\n\n")}\n`;
}

/** `loop-<slug of title>`, with `-2`, `-3`... when the ledger already has it. */
export function uniqueLoopId(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `loop-${slugify(title)}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Parse a whole ledger file into entries. Junk between/around blocks is ignored, never thrown on. */
export function parseLoopsFile(content: string): LoopEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: LoopEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = HEADER.exec(lines[i]);
    if (!head) {
      i++;
      continue;
    }
    const id = head[1];
    i++;

    let title = "";
    let openedAt = NaN;
    let openedRaw: string | undefined;
    const extraMeta: string[] = [];
    let resurface: string | undefined;
    let status: LoopStatus = "open";
    let owner: string | undefined;
    let state: string | undefined;
    let tags: string[] = [];

    for (let m: RegExpExecArray | null; i < lines.length && (m = META.exec(lines[i])); i++) {
      const key = m[1];
      const val = m[2].trim();
      if (key === "title") title = val;
      else if (key === "opened") {
        openedAt = Date.parse(val);
        openedRaw = val;
      }
      else if (key === "resurface") resurface = val || undefined;
      // Any value that is not a kit status is tolerated as "open", hand-edited
      // junk in this field must never break the rest of the parse.
      else if (key === "status") status = (LOOP_STATUS as readonly string[]).includes(val) ? (val as LoopStatus) : "open";
      else if (key === "owner") owner = val || undefined;
      else if (key === "state") state = val || undefined;
      else if (key === "tags") tags = val.split(",").map((t) => t.trim()).filter(Boolean);
      else extraMeta.push(lines[i]);
    }

    // Optional single blank line separating metadata from the verbatim note.
    if (i < lines.length && lines[i].trim() === "") i++;

    const textLines: string[] = [];
    while (i < lines.length && !HEADER.test(lines[i])) textLines.push(lines[i++]);
    const note = textLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");

    // Fall back to the date or epoch embedded in the id when `opened:` is missing/garbage.
    if (!Number.isFinite(openedAt)) {
      const idm = /^loop-(\d+)$/.exec(id);
      const dm = /^loop-(\d{4}-\d{2}-\d{2})(?:-|$)/.exec(id);
      openedAt = idm ? Number(idm[1]) : dm ? Date.parse(dm[1]) : 0;
      if (!Number.isFinite(openedAt)) openedAt = 0;
    }
    // Only keep the raw text when writing the date form would change it.
    const keepRaw =
      openedRaw === undefined ? null : Number.isFinite(openedAt) && dayOf(openedAt) === openedRaw ? undefined : openedRaw;

    entries.push({
      id,
      title,
      note,
      openedAt,
      ...(keepRaw !== undefined ? { openedRaw: keepRaw } : {}),
      status,
      ...(extraMeta.length ? { extraMeta } : {}),
      ...(resurface ? { resurface } : {}),
      ...(owner ? { owner } : {}),
      ...(state ? { state } : {}),
      ...(tags.length ? { tags } : {}),
    });
  }
  return entries;
}

/** Local calendar date (`YYYY-MM-DD`) for a timestamp, NOT UTC. Mirrors the `today()`
 *  convention used across the codebase (e.g. `src/obsidian/tools.ts`): toISOString()
 *  would roll to tomorrow late at night in a positive-offset timezone. */
function localDateString(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** All loops not yet closed (open or waiting on the user), in ledger order. */
export function activeLoops(entries: LoopEntry[]): LoopEntry[] {
  return entries.filter((e) => e.status !== "closed");
}

/**
 * Open loops that are due to resurface: no `resurface` date (due immediately),
 * or a `resurface` date on/before `now`'s local calendar day. Comparison is by
 * local date string (`YYYY-MM-DD`, lexicographic == chronological), so it is
 * timezone-safe and time-of-day-independent, only the calendar day matters.
 */
export function dueLoops(entries: LoopEntry[], now: number | Date = Date.now()): LoopEntry[] {
  const today = localDateString(now);
  return activeLoops(entries).filter((e) => !e.resurface || e.resurface <= today);
}

/**
 * Close a loop: `status: closed`, the `state` line carries the outcome, and the
 * outcome is appended to the note. The opening note is NEVER overwritten or
 * removed (spec 4.3). Every other entry is returned unchanged. Throws if `id`
 * isn't present, since a close that silently no-ops would look like success but
 * lose the caller's outcome text.
 */
export function closeLoop(
  entries: LoopEntry[],
  id: string,
  outcome?: string,
  now: number | Date = Date.now()
): LoopEntry[] {
  const day = dayOf(now instanceof Date ? now.getTime() : now);
  const text = outcome?.replace(/\s+/g, " ").trim();
  let found = false;
  const next = entries.map((e) => {
    if (e.id !== id) return e;
    found = true;
    const closed: LoopEntry = {
      ...e,
      status: "closed",
      state: text ? `closed ${day}: ${text}` : `closed ${day}`,
      note: text ? `${e.note}\n\nOutcome ${day}: ${text}`.trim() : e.note,
    };
    return closed;
  });
  if (!found) throw new Error(`Loop not found: ${id}`);
  return next;
}
