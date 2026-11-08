/**
 * Exo memory-layer paths: one source of truth, all derived from one root.
 *
 * The layout is the cyber-brain spec (../cyber-brain/SPEC.md section 2). The
 * root is the vault's `AGENTS.md` frontmatter `paths.system` (see
 * `brain-config.ts`), `System` when the vault has none. Pure module (no
 * Obsidian imports) so it stays unit-testable.
 */

/** The spec's default system folder. */
export const DEFAULT_MEMORY_ROOT = "System";

/** Every vault-relative path Exo's memory features read or write, split into
 *  MECHANISM (the tool's own operational data — needed by any vault that uses
 *  memory features) and CONTENT (the marioverse knowledge-OS — scaffolded only
 *  by the opt-in "Full" template). */
export interface ExoPaths {
  root: string;
  // ── mechanism ────────────────────────────────────────────────────────────
  memory: string;
  /** Exo's transit folder (`memory/inbox/exo`): one `YYYY-MM-DD.md` per day of
   *  entries the nightly `dream` places. The only file the harvest may create. */
  inbox: string;
  queue: string;
  reports: string;
  review: string;
  mentions: string;
  /** Agent contracts — one `<slug>.md` sidecar per agent. The agent's prompt
   *  lives in `.claude/agents/`; this folder holds only triggers/scope/autonomy,
   *  because `.claude/` is gitignored and does not sync to mobile. */
  agents: string;
  /** Run log (spec 4.5), one `YYYY-MM.md` per month. */
  agentRuns: string;
  /** Settled chats mirrored into the vault, one note per conversation. Beside
   *  `reports/` and `agents/` because it is the same kind of thing: output Exo
   *  produced that the vault now owns, indexed, linkable and in the graph. */
  chats: string;
  /** Unified automations — one readable `<slug>.md` per automation (name,
   *  description, when, mode, scope in frontmatter; prompt as the body). */
  automations: string;
  /** Per-agent compounding memory — a scope under vault memory, not a new store. */
  agentMemory: string;
  openLoops: string;
  workflowSignals: string;
  // ── content (spec identity and memory) ───────────────────────────────────
  /** `identity/`: SOUL, USER, NOW. */
  agentDir: string;
  /** The vault's entry point, `AGENTS.md` at the vault root. */
  vaultContext: string;
  /** `identity/observations.md`: append-only observations about the user. */
  observations: string;
  rules: string;
  decisions: string;
}

/** Build the full path set from a root. Falls back to the default root when
 *  given an empty string, and trims any trailing slashes so callers can pass a
 *  user-entered value safely. */
export function exoPaths(root: string): ExoPaths {
  const r = (root || DEFAULT_MEMORY_ROOT).replace(/\/+$/, "");
  const memory = `${r}/memory`;
  return {
    root: r,
    memory,
    inbox: `${memory}/inbox/exo`,
    queue: `${r}/exo-queue`,
    reports: `${r}/reports`,
    review: `${r}/review.md`,
    mentions: `${r}/mentions`,
    agents: `${r}/agents`,
    agentRuns: `${r}/runs`,
    chats: `${r}/chats`,
    automations: `${r}/automations`,
    agentMemory: `${memory}/agents`,
    openLoops: `${memory}/loops.md`,
    workflowSignals: `${memory}/workflow-signals.json`,
    agentDir: `${r}/identity`,
    vaultContext: "AGENTS.md",
    observations: `${r}/identity/observations.md`,
    rules: `${memory}/rules`,
    decisions: `${memory}/decisions`,
  };
}
