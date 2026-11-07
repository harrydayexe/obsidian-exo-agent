/**
 * Which notes are superseded and by what. A note is superseded when its
 * `status` says so, when it names a `superseded_by`, or when another existing
 * note lists it in `supersedes`. Recall uses the index to lead with the
 * current note; the inconsistent markers it finds become correction proposals.
 * No Obsidian import: links arrive already resolved to paths.
 */
import { formatFact, parseFact } from "../vendor/cyber-brain/core.mjs";
import { frontmatterKeyLines } from "./frontmatter-patch";
import { PROPOSAL_LIMITS } from "./proposals";
import { factSafe } from "./text-safety";

/** One note's markers. Links resolved to vault paths; unresolved kept as raw text. */
export interface NoteMarkers {
  path: string;
  status?: string;
  supersedes: string[];
  supersededBy: string[];
}

export interface SupersedeIndex {
  /** The current note at the end of the successor chain, or null when unknown. */
  headOf(path: string): string | null;
  isSuperseded(path: string): boolean;
  successorOf(path: string): string | null;
}

/** A frontmatter-only repair: never the body. */
export interface MarkerFix {
  path: string;
  set: { status?: "superseded"; superseded_by?: string };
  because: string;
}

export interface BrokenLink {
  path: string;
  field: "supersedes" | "superseded_by";
  target: string;
}

/** The keys a fix writes. Given the note's text as read now, a key Mario
 *  already filled is left alone: any non-empty `superseded_by` (however it is
 *  written, quoted or not, which the metadata cache may not show as a link),
 *  and a `status` that already says superseded. Empty when nothing is left. */
export function markerKeys(fix: MarkerFix, content?: string): Record<string, string> {
  const keys = Object.fromEntries(Object.entries(fix.set).filter((e): e is [string, string] => e[1] !== undefined));
  if (content === undefined) return keys;
  if (keyValue(content, "superseded_by")) delete keys.superseded_by;
  if (keyValue(content, "status").replace(/^(["'])(.*)\1$/, "$2").toLowerCase() === "superseded") delete keys.status;
  return keys;
}

/** A key's value as written (continuation lines joined, comments cut), "" when
 *  the key is absent or holds nothing (`key:`, `""`, `null`, `~`, `[]`). */
function keyValue(content: string, key: string): string {
  const value = frontmatterKeyLines(content, key)
    .map((line, i) => (i ? line : line.slice(line.indexOf(":") + 1)))
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n")
    .trim();
  return /^(?:""|''|null|~|\[\s*\])?$/i.test(value) ? "" : value;
}

const FIELDS = { supersedes: "supersedes", superseded_by: "supersededBy" } as const;

/** Markers from one note's frontmatter and its frontmatter links (`key` as
 *  Obsidian reports it: `supersedes`, `supersedes.0`, ...). */
export function markersOf(
  path: string,
  frontmatter: Record<string, unknown> | undefined,
  links: readonly { key: string; target: string }[],
): NoteMarkers {
  const out: NoteMarkers = { path, supersedes: [], supersededBy: [] };
  if (typeof frontmatter?.status === "string") out.status = frontmatter.status;
  for (const l of links) {
    const field = FIELDS[l.key.split(".")[0] as keyof typeof FIELDS];
    if (field) out[field].push(l.target);
  }
  const raw = frontmatter?.superseded_by;
  if (!out.supersededBy.length && typeof raw === "string" && raw.trim()) out.supersededBy.push(raw.trim());
  return out;
}

const basename = (path: string): string => path.replace(/^.*\//, "").replace(/\.md$/, "");
const fileDate = (path: string): string => /(\d{4}-\d{2}-\d{2})/.exec(basename(path))?.[1] ?? "";
/** Newest first: filename date, then path. */
const newest = (a: string, b: string): number =>
  fileDate(b).localeCompare(fileDate(a)) || (a < b ? 1 : a > b ? -1 : 0);

/** The explanation as one string that always passes the proposal validator:
 *  the structural reason comes first, so a long run of broken links is what gets cut. */
function boundedReason(parts: readonly string[]): string {
  const text = parts.join(" ");
  const max = PROPOSAL_LIMITS.rationale;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildSupersedeIndex(notes: readonly NoteMarkers[]): {
  index: SupersedeIndex;
  fixes: MarkerFix[];
  broken: BrokenLink[];
} {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const reverse = new Map<string, string[]>();
  const broken: BrokenLink[] = [];
  for (const n of notes) {
    for (const t of n.supersedes) {
      if (t === n.path) continue;
      if (!byPath.has(t)) broken.push({ path: n.path, field: "supersedes", target: t });
      else reverse.set(t, [...(reverse.get(t) ?? []), n.path]);
    }
    for (const t of n.supersededBy) {
      if (t !== n.path && !byPath.has(t)) broken.push({ path: n.path, field: "superseded_by", target: t });
    }
  }
  const forward = (path: string): string[] => (byPath.get(path)?.supersededBy ?? []).filter((t) => t !== path);
  const linkers = (path: string): string[] => [...(reverse.get(path) ?? [])].sort(newest);

  const isSuperseded = (path: string): boolean =>
    byPath.get(path)?.status === "superseded" || forward(path).length > 0 || linkers(path).length > 0;
  const successorOf = (path: string): string | null =>
    forward(path).find((t) => byPath.has(t)) ?? linkers(path)[0] ?? null;
  const headOf = (path: string): string | null => {
    const seen = new Set([path]);
    let at = path;
    for (let next = successorOf(at); next && !seen.has(next); next = successorOf(at)) {
      seen.add(next);
      at = next;
      if (!isSuperseded(at)) break;
    }
    return at === path ? null : at;
  };

  const fixes: MarkerFix[] = [];
  for (const n of notes) {
    const by = linkers(n.path)[0];
    if (!by) continue;
    const set: MarkerFix["set"] = {};
    const why: string[] = [];
    if (n.status !== "superseded") {
      set.status = "superseded";
      why.push(`${basename(by)} lists this note in supersedes, but it is not marked as superseded.`);
    }
    if (!forward(n.path).length) {
      set.superseded_by = `[[${basename(by)}]]`;
      if (!set.status) why.push(`${basename(by)} lists this note in supersedes, but its superseded_by is missing.`);
    }
    if (!why.length) continue;
    for (const b of broken.filter((x) => x.path === n.path)) {
      why.push(`Broken link: ${b.field} points at ${b.target}, which does not exist.`);
    }
    fixes.push({ path: n.path, set, because: boundedReason(why) });
  }

  return { index: { headOf, isSuperseded, successorOf }, fixes, broken };
}

/**
 * Lead with the current note: a superseded hit whose head is not among the
 * hits gives its slot to the head (`fetchHead`) and stays right below it,
 * labelled. A head already present means label only. Demoted, never hidden.
 */
export function applySupersede<T extends { path: string }>(
  hits: readonly T[],
  index: SupersedeIndex,
  fetchHead: (path: string) => T | null,
): (T & { supersededBy?: string })[] {
  const present = new Set(hits.map((h) => h.path));
  const out: (T & { supersededBy?: string })[] = [];
  for (const h of hits) {
    const head = index.isSuperseded(h.path) ? index.headOf(h.path) : null;
    if (!head) {
      out.push(h);
      continue;
    }
    const fetched = present.has(head) ? null : fetchHead(head);
    if (fetched) {
      out.push(fetched);
      present.add(head);
    }
    out.push({ ...h, supersededBy: head });
  }
  return out;
}

const MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)/;

/** A line's text without indent and list marker (`- `, `1. `, `- [ ] `). */
export const withoutListMarker = (line: string): string => line.trim().replace(MARKER, "").trim();

/** A trailing Obsidian block anchor, ` ^exo-abc123`. */
const ANCHOR_TAIL = /\s\^[\w-]+\s*$/;

/** The changed-fact line of spec 4.1: `<new> [source: ..; since: <date>; was: <old>]`,
 *  keeping the old line's indent, list marker and block anchor. `was` is the
 *  old fact's text (its own tail dropped when it was a fact line). A line
 *  without a list marker stays without one. */
export function formatSupersede(oldLine: string, newText: string, date: string, source: string): string {
  const { prefix, anchor, fact } = splitLine(oldLine);
  const next = newText.trim().replace(MARKER, "");
  const line = formatFact(next, { source: factSafe(source), since: date, was: factSafe(fact) });
  return `${prefix || (oldLine.match(/^\s*/) ?? [""])[0]}${line.slice(2)}${anchor ? ` ${anchor}` : ""}`;
}

/** A line as `[list marker, block anchor, fact text]`: the text without marker,
 *  anchor or (for a fact line) its `[source: ...]` tail. */
function splitLine(line: string): { prefix: string; anchor: string; fact: string } {
  const prefix = MARKER.exec(line)?.[1] ?? "";
  const anchor = ANCHOR_TAIL.exec(line)?.[0].trim() ?? "";
  const bare = (anchor ? line.slice(0, line.length - anchor.length) : line).slice(prefix.length).trim();
  const parsed = parseFact(`- ${bare}`);
  return { prefix, anchor, fact: parsed && !parsed.error ? parsed.text : bare };
}

/** The fact a line states: no list marker, block anchor or fact tail. This is
 *  the `was:` of a transit entry that replaces the line. */
export const factTextOf = (line: string): string => splitLine(line).fact;
