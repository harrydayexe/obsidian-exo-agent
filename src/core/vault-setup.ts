/**
 * Vault Setup — pure logic (no Obsidian imports).
 *
 * Exo reads and writes a fixed set of paths under its memory root for its
 * memory features (open loops, preferences, cockpit staleness). On a fresh vault none of that exists, so every one of those
 * features silently degrades to empty/inert with no signal to the user that
 * anything is missing. `scaffoldItems(paths)` is the create-only-if-absent
 * list that fixes that; `isVaultSetUp` is the single-file detection check used
 * to decide whether to offer the scaffold at all.
 *
 * All paths derive from the caller-supplied `ExoPaths` (core/paths.ts), so the
 * root is configurable and the module stays pure/testable.
 *
 * The "full" preset also lays down the spec's knowledge layer: the
 * observations note, README-documented rules/decisions folders, and
 * hand-fillable `identity/{SOUL,USER,NOW}.md` kernel blocks. The blocks carry a template marker so the "Agent Is
 * the Folder" seeder regenerates them while untouched (isUnfilledAgentBlock) yet
 * never clobbers hand-written identity — that's why pre-creating them is now
 * safe, where a blank stub would once have looked already-seeded.
 *
 * Still excluded: `review.md` (its mere existence is read as a UI signal that
 * there's something to review).
 */

import type { ExoPaths } from "./paths";
import { AGENT_BLOCK_NAMES, agentBlockTemplate } from "./agent-self";
import { LOOPS_FILE_HEADER } from "./open-loops";

export type ScaffoldKind = "folder" | "file";

/**
 * What the user picks at onboarding (persisted as `settings.memorySetup`):
 *  - `none`    → create nothing; memory features stay inert until the user
 *                opts into setup later. Boot reads CLAUDE.md only.
 *  - `minimal` → the tool's own operational layer (open loops,
 *                reports), no marioverse knowledge-OS.
 *  - `full`    → minimal + the marioverse content scaffold (preferences,
 *                vault-context, rules/decisions folders).
 * `undefined` (setting unset) = not chosen yet → the picker is still offered.
 */
export type MemorySetup = "none" | "minimal" | "full";

/** Whether a scaffold item belongs to the tool's operational layer
 *  (`mechanism`, created by both minimal and full) or the marioverse
 *  knowledge-OS (`content`, full only). Mirrors the split documented on
 *  `ExoPaths` in core/paths.ts. */
export type ScaffoldTier = "mechanism" | "content";

export interface ScaffoldItem {
  path: string;
  kind: ScaffoldKind;
  tier: ScaffoldTier;
  /** Starter content for `kind: "file"`. Always absent for `kind: "folder"`. */
  content?: string;
}

const heading = (title: string, body: string): string => `# ${title}\n\n${body}\n`;

/** Every create-only-if-absent item for a given memory root, tagged by tier.
 *  `scaffoldItems` filters this by the chosen preset — this stays the single
 *  place the full item set is defined. */
function allScaffoldItems(paths: ExoPaths): ScaffoldItem[] {
  return [
    // ── mechanism (minimal + full) ─────────────────────────────────────────
    { path: paths.queue, kind: "folder", tier: "mechanism" },
    { path: paths.reports, kind: "folder", tier: "mechanism" },
    { path: paths.openLoops, kind: "file", tier: "mechanism", content: LOOPS_FILE_HEADER },
    // ── content (full only): guided templates + the knowledge-OS folders ────
    { path: `${paths.rules}/README.md`, kind: "file", tier: "content", content: FOLDER_README.rules },
    { path: `${paths.decisions}/README.md`, kind: "file", tier: "content", content: FOLDER_README.decisions },
    { path: paths.observations, kind: "file", tier: "content", content: OBSERVATIONS_TEMPLATE },
    // Identity blocks: guided, hand-fillable templates that "Seed agent folder"
    // regenerates while untouched (isUnfilledAgentBlock) and never clobbers once
    // edited. Path derives from paths.agentDir.
    ...AGENT_BLOCK_NAMES.map((name) => ({
      path: `${paths.agentDir}/${name}.md`,
      kind: "file" as const,
      tier: "content" as const,
      content: agentBlockTemplate(name),
    })),
  ];
}

const FOLDER_README = {
  rules: heading(
    "Rules",
    "One durable rule per file: patterns confirmed across sessions that Exo should always follow. Add one once you've seen a pattern hold three times."
  ),
  decisions: heading(
    "Decisions",
    "One decision record per file: the choice, the context, the trade-offs, and when to revisit it. Exo appends here when you decide something that shapes future work."
  ),
} as const;

const OBSERVATIONS_TEMPLATE = `---
description: Append-only observations about the user: preferences, habits, ways of deciding. Open to see what agents learned about you.
sensitivity: personal
---
# Observations

One fact per line: \`- <observation> [source: <where>; since: YYYY-MM-DD]\`. Exo reads this at boot and appends to it; the weekly review rebuilds USER.md from it.
`;

/** The create-only-if-absent scaffold for a given memory root and preset.
 *  `minimal` yields the mechanism items; `full` yields all of them. (`none`
 *  never scaffolds, so it isn't a valid preset here.) */
export function scaffoldItems(paths: ExoPaths, preset: Exclude<MemorySetup, "none">): ScaffoldItem[] {
  const items = allScaffoldItems(paths);
  return preset === "full" ? items : items.filter((it) => it.tier === "mechanism");
}

/** The parent directory of a scaffold path, or null if the path has no
 *  slash (top-level). Every `kind: "file"` item is nested, so this always
 *  resolves for them — `applyMemorySetup` uses it to ensure the parent folder
 *  exists before creating the file, since `vault.create()` (unlike
 *  `vault.createFolder()`) does not create intermediate directories. */
export function parentFolder(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i === -1 ? null : path.slice(0, i);
}

/** True when the vault already has Exo's memory layer set up, detected via
 *  the loops file both presets create. Covers installs that never recorded a
 *  `memorySetup` choice but have the layer. `exists` is injected so this stays
 *  pure and testable without an Obsidian App. */
export function isVaultSetUp(exists: (path: string) => boolean, paths: ExoPaths): boolean {
  return exists(paths.openLoops);
}

/** Whether to offer the onboarding picker. Offered only when the user hasn't
 *  made a choice yet (`memorySetup` unset) AND the vault isn't already a
 *  pre-picker install with the layer in place. Once any choice is recorded —
 *  including `none` — this is false, so the picker never nags again. */
export function memorySetupNeeded(memorySetup: MemorySetup | undefined, isSetUp: boolean): boolean {
  return memorySetup === undefined && !isSetUp;
}
