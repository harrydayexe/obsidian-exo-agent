/**
 * An identity-block rewrite as a transit entry (spec 5.1, `writers: inbox`):
 * `dream` places it in `identity/<BLOCK>.md`. Transit entries are one line and
 * blocks are placed line by line, so the new content is one-lined and the
 * first body line of the current block is the line it replaces.
 */
import { formatTransit } from "../vendor/cyber-brain/core.mjs";
import { factSafe, oneLine } from "./text-safety";

/** First line of a block that is not a heading, or undefined when it has none. */
export function firstBodyLine(current: string | null): string | undefined {
  for (const raw of (current ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#") && !line.startsWith("<!--")) return line;
  }
  return undefined;
}

export function blockTransitEntry(input: {
  /** Identity file the block lives in, e.g. `System/identity/NOW.md`. */
  target: string;
  content: string;
  rationale?: string;
  /** Current content of that file, when there is one. */
  current: string | null;
  date: string;
}): string {
  const was = firstBodyLine(input.current);
  const source = factSafe(input.rationale ? `exo rethink: ${input.rationale}` : "exo rethink");
  return formatTransit("block", oneLine(input.content), input.target, source, input.date, was ? factSafe(was) : undefined);
}
