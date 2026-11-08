/**
 * A decision file in the cyber-brain format (spec 4.4): description, status
 * and date in the frontmatter, then Context, Options, Decision, Trade-offs.
 * Pure: both decision writers (the tool and the accepted proposal) use it.
 */
import { oneLine } from "./text-safety";

export interface DecisionRecord {
  title: string;
  context: string;
  decision: string;
  /** Why this and not the others; the Trade-offs section. */
  rationale: string;
  options?: string;
  /** When to reopen it; closes the Trade-offs section. */
  revisit?: string;
  date: string;
  /** Hidden line at the end that a retried proposal is recognised by. */
  marker?: string;
}

const DESCRIPTION_MAX = 160;

export function formatDecision(d: DecisionRecord): string {
  const description = oneLine(d.decision).slice(0, DESCRIPTION_MAX);
  const tradeOffs = d.revisit?.trim() ? `${d.rationale}\n\nRevisit if: ${d.revisit}` : d.rationale;
  return (
    `---\ndescription: ${JSON.stringify(description)}\nstatus: accepted\ndate: ${d.date}\n---\n` +
    `# ${oneLine(d.title)}\n\n` +
    `## Context\n${d.context}\n\n` +
    (d.options ? `## Options\n${d.options}\n\n` : "") +
    `## Decision\n${d.decision}\n\n` +
    `## Trade-offs\n${tradeOffs}\n` +
    (d.marker ? `\n${d.marker}\n` : "")
  );
}
