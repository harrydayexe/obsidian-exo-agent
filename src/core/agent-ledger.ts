/**
 * Agent run log, pure parser/serializer (no Obsidian imports).
 *
 * The cyber-brain run record (../cyber-brain/SPEC.md section 4.5): one file per
 * month under `paths.agentRuns`, one `## <time> <agent> <skill>` block per run
 * and one `- write: <path> | <before> | <after>` receipt per changed line.
 * Exo's own fields (name, trigger, tier, started, duration, report, restore)
 * ride as extra `- key: value` lines the kit parser keeps in `fields`. The
 * block shape is the kit's, so `brain.mjs check` and `dream` read Exo's runs
 * and Exo reads theirs.
 *
 * Exo writes the facts (who ran, why, what changed, whether it worked); the
 * agent writes judgment into its own memory file. Neither writes the other's half.
 */

import { SUMMARY_MAX, parseRuns } from "../vendor/cyber-brain/core.mjs";
import { stripFrontmatter } from "./agents";

export type AgentRunOutcome = "ok" | "failed" | "refused";

export interface AgentRunRecord {
  /** The run's header line: `<time> <agent> work`. Unique per agent and second. */
  id: string;
  slug: string;
  /** Display name at the time of the run: names drift, records should not. */
  name: string;
  startedAt: number;
  durationMs: number;
  outcome: AgentRunOutcome;
  /** Human-readable trigger ("daily 08:00", "create _inbox/x.md", "manual"). */
  trigger: string;
  /** Autonomy tier the run executed under. */
  tier: string;
  /** Vault path of the run report, when one was written. */
  report?: string;
  /** The run's `write:` receipts, each `<path> | <before> | <after>`. */
  writes: string[];
  /**
   * Id of the checkpoint record backing "Restore" for this run, when it wrote.
   *
   * Stored rather than derived: the checkpoint id embeds `startedAt` but also a
   * random suffix, so correlating the two records by timestamp would be a guess.
   * Absent for read-only runs, which have nothing to restore.
   */
  restoreId?: string;
  /**
   * Who asked. `exo` for a trigger or a human; an agent slug when this run was
   * delegated by another agent: the attribution chain that makes agent-to-agent
   * work auditable instead of anonymous. On disk `exo` is `user` (manual) or
   * `schedule`, the kit's values.
   */
  by: string;
  /** One-line summary, when the run produced one. */
  summary?: string;
}

/** `2026-08.md`: the log file a given instant belongs to. */
export function ledgerFileName(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.md`;
}

/** A new month file: the description line every system file carries. */
export function ledgerHeader(at: number): string {
  const month = ledgerFileName(at).replace(/\.md$/, "");
  return `---\ndescription: Run log for ${month}, one record per agent run with the exact lines written. Open to review or undo a write.\nsensitivity: personal\n---\n# Runs ${month}\n`;
}

export function agentRunId(slug: string, startedAt: number): string {
  return `${new Date(startedAt).toISOString()}\u00b7${slug}`;
}

const esc = (s: string) => s.replace(/\r?\n/g, " ").trim();
const clamp = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}\u2026` : s);

/** The header of a run's block: `2026-11-07T15:20:11Z <agent> work` (kit shape). */
export function runHeader(slug: string, startedAt: number): string {
  return `${new Date(startedAt).toISOString().replace(/\.\d{3}Z$/, "Z")} ${slug} work`;
}

/** The kit's `by`: Exo's own trigger is the user when manual, else the schedule. */
function diskBy(r: AgentRunRecord): string {
  return r.by === "exo" ? (r.trigger === "manual" ? "user" : "schedule") : r.by;
}

/** One record as a markdown block. Always starts with a blank line so appends
 *  concatenate cleanly without a read-modify-write of the whole file. */
export function serializeAgentRun(r: AgentRunRecord): string {
  const summary = r.summary ?? `${r.name} ${r.outcome === "ok" ? "ran" : r.outcome} (${r.trigger})`;
  return [
    "",
    `## ${runHeader(r.slug, r.startedAt)}`,
    `- agent: ${r.slug}`,
    `- by: ${diskBy(r)}`,
    `- outcome: ${r.outcome}`,
    `- summary: ${clamp(esc(summary), SUMMARY_MAX)}`,
    `- name: ${esc(r.name)}`,
    `- trigger: ${esc(r.trigger)}`,
    `- tier: ${r.tier}`,
    `- started: ${new Date(r.startedAt).toISOString()}`,
    `- duration: ${Math.max(0, Math.round(r.durationMs / 1000))}s`,
    ...(r.report ? [`- report: ${r.report}`] : []),
    ...(r.restoreId ? [`- restore: ${r.restoreId}`] : []),
    ...r.writes.map((w) => `- write: ${w}`),
    "",
  ].join("\n");
}

/** Parse a log file. Unknown or malformed blocks are skipped, never thrown: a
 *  hand-edited log must degrade, not break the pane that reads it. */
export function parseAgentLedger(raw: string): AgentRunRecord[] {
  const out: AgentRunRecord[] = [];
  for (const run of parseRuns(raw)) {
    const f = run.fields;
    const slug = f.agent;
    // `started` is Exo's own millisecond stamp; a kit-written record only has the header time.
    const startedAt = Date.parse(f.started || run.header.split(" ")[0]);
    if (!slug || !Number.isFinite(startedAt)) continue;
    const outcome: AgentRunOutcome = f.outcome === "ok" || f.outcome === "failed" || f.outcome === "refused" ? f.outcome : "failed";
    const seconds = Number.parseInt(f.duration ?? "0s", 10);
    const by = !f.by || f.by === "user" || f.by === "schedule" ? "exo" : f.by;
    out.push({
      id: run.header,
      slug,
      name: f.name || slug,
      startedAt,
      durationMs: Number.isFinite(seconds) ? seconds * 1000 : 0,
      outcome,
      trigger: f.trigger || "unknown",
      tier: f.tier || "propose",
      ...(f.report ? { report: f.report } : {}),
      ...(f.restore ? { restoreId: f.restore } : {}),
      writes: run.writes,
      by,
      ...(f.summary ? { summary: f.summary } : {}),
    });
  }
  return out;
}

/** The path a `write:` receipt names. */
export const receiptPath = (receipt: string): string => receipt.split(" | ")[0];

const RECEIPT_MAX_PER_FILE = 40;
/** A line as a receipt field: a pipe would split the field, so it is escaped. */
const flat = (line: string): string => line.trim().replace(/\|/g, "\\|");

/**
 * The `write:` receipts for one file a run changed (spec 4.5): one per changed
 * line, `<path> | <before> | <after>`, blank lines never logged. A new file is
 * `(new file)` with its first line as the after; a removed file `(deleted)`.
 * The changed middle is paired line by line, capped at {@link RECEIPT_MAX_PER_FILE}.
 */
export function lineReceipts(path: string, before: string | null, after: string | null): string[] {
  const lines = (text: string): string[] => text.split(/\r?\n/);
  if (before === null) {
    const first = lines(after ?? "").find((l) => l.trim());
    return [`${path} | (new file) | ${first ? flat(first) : "(none)"}`];
  }
  if (after === null) {
    const first = lines(before).find((l) => l.trim());
    return [`${path} | ${first ? flat(first) : "(none)"} | (deleted)`];
  }
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const was = a.slice(head, a.length - tail);
  const now = b.slice(head, b.length - tail);
  const out: string[] = [];
  for (let i = 0; i < Math.max(was.length, now.length); i++) {
    const x = (was[i] ?? "").trim();
    const y = (now[i] ?? "").trim();
    if (x === y) continue;
    out.push(`${path} | ${x ? flat(x) : "(none)"} | ${y ? flat(y) : "(none)"}`);
  }
  if (out.length > RECEIPT_MAX_PER_FILE) {
    const more = out.length - RECEIPT_MAX_PER_FILE;
    return [...out.slice(0, RECEIPT_MAX_PER_FILE), `${path} | (${more} more changed lines) | (see the file)`];
  }
  return out.length ? out : [`${path} | (none) | (none)`];
}

/** Newest first — the order every consumer wants. */
export function sortRuns(runs: AgentRunRecord[]): AgentRunRecord[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt);
}

export function runsForAgent(runs: AgentRunRecord[], slug: string): AgentRunRecord[] {
  return sortRuns(runs.filter((r) => r.slug === slug));
}

/** The delegation chain that produced a run, oldest caller first. Cycles are
 *  impossible by construction (depth cap) but the walk is bounded anyway. */
export function attributionChain(runs: AgentRunRecord[], id: string, max = 8): string[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const chain: string[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor && chain.length < max && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor.slug);
    if (cursor.by === "exo") break;
    cursor = runs.find((r) => r.slug === cursor!.by && r.startedAt <= cursor!.startedAt);
  }
  return chain;
}

/* ------------------------------- memory ------------------------------- */

/** Vault path of an agent's compounding memory. A scope under vault memory —
 *  not a fifth store; the Memory Map's precedence rules are unchanged. */
export function agentMemoryPath(agentMemoryDir: string, slug: string): string {
  return `${agentMemoryDir}/${slug}.md`;
}

/** Seed content for an agent's memory file. */
export function initialAgentMemory(name: string, slug: string, today = ""): string {
  return [
    "---",
    "type: memory",
    "subtype: agent-memory",
    `agent: ${slug}`,
    "created_by: exo",
    ...(today ? [`last_updated: ${today}`] : []),
    "tags:",
    "  - type/memory",
    "---",
    "",
    `# ${name} — memory`,
    "",
    "> What this agent has learned across runs. It reads this file before every run",
    "> and appends to it when a run produces something durable. Edit it freely —",
    "> a line removed here is a lesson the agent forgets.",
    "",
    "## Learnings",
    "",
  ].join("\n");
}

/** Trim an agent's memory to the block that rides into a run prompt. Keeps the
 *  tail (most recent learnings) when the file has outgrown the budget. */
export function agentMemoryExcerpt(raw: string, maxChars = 4000): string {
  const body = stripFrontmatter(raw).trim();
  if (body.length <= maxChars) return body;
  const tail = body.slice(body.length - maxChars);
  const cut = tail.indexOf("\n");
  return `…\n${cut === -1 ? tail : tail.slice(cut + 1)}`;
}
