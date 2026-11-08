/**
 * The vault's cyber-brain configuration: the frontmatter of its `AGENTS.md`
 * (../cyber-brain/SPEC.md section 3.1). Exo reads where the system folder is,
 * who writes shared notes directly, and where the daily note and its agents
 * heading are. Pure module (no Obsidian imports); the file read is injected.
 */
import { parseFrontmatter } from "../vendor/cyber-brain/core.mjs";
import { DEFAULT_MEMORY_ROOT } from "./paths";

export interface BrainConfig {
  /** `paths.system`: the folder that holds identity, memory and runs. */
  system: string;
  /** `inbox`: facts and blocks wait in transit for `dream`. `direct`: they land at once. */
  writers: "inbox" | "direct";
  /** `daily_notes` pattern with YYYY, MM, DD tokens; empty when the vault has none. */
  dailyNotes: string;
  /** Heading the run summaries go under. */
  dailyHeading: string;
}

/** The spec default for `daily_heading`. */
export const DEFAULT_DAILY_HEADING = "### Agents";

/** A vault without a cyber-brain `AGENTS.md`: the spec's folder, no dream to
 *  place transit, so Exo writes shared notes itself. */
export const DEFAULT_BRAIN: BrainConfig = {
  system: DEFAULT_MEMORY_ROOT,
  writers: "direct",
  dailyNotes: "",
  dailyHeading: DEFAULT_DAILY_HEADING,
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The configuration in `agentsMd`, or {@link DEFAULT_BRAIN} when the file is
 *  missing or is not a cyber-brain `AGENTS.md` (no `cyber_brain:` key). */
export function parseBrainConfig(agentsMd: string | null): BrainConfig {
  if (!agentsMd) return DEFAULT_BRAIN;
  const { data } = parseFrontmatter(agentsMd);
  if (data.cyber_brain === undefined) return DEFAULT_BRAIN;
  const paths = (data.paths && typeof data.paths === "object" ? data.paths : {}) as Record<string, unknown>;
  return {
    system: text(paths.system).replace(/^\/+|\/+$/g, "") || DEFAULT_MEMORY_ROOT,
    writers: text(data.writers) === "direct" ? "direct" : "inbox",
    dailyNotes: text(data.daily_notes),
    dailyHeading: text(data.daily_heading) || DEFAULT_DAILY_HEADING,
  };
}

/** The daily note for `at`, from the `daily_notes` pattern; "" when unset. */
export function dailyNoteFor(pattern: string, at: number | Date): string {
  if (!pattern) return "";
  const d = at instanceof Date ? at : new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return pattern
    .replace("YYYY", String(d.getFullYear()))
    .replace("MM", pad(d.getMonth() + 1))
    .replace("DD", pad(d.getDate()))
    .replace(/[{}]/g, "");
}

/** Read and parse the vault's `AGENTS.md` through an injected reader. */
export async function readBrainConfig(read: (path: string) => Promise<string | null>): Promise<BrainConfig> {
  try {
    return parseBrainConfig(await read("AGENTS.md"));
  } catch {
    return DEFAULT_BRAIN;
  }
}
