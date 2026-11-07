import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatFact, formatTransit, parseFact, parseTransit } from "../src/vendor/cyber-brain/core.mjs";

const vendored = new URL("../src/vendor/cyber-brain/core.mjs", import.meta.url);
const source = new URL("../../cyber-brain/scripts/core.mjs", import.meta.url);

describe("vendored cyber-brain core", () => {
  it.skipIf(!existsSync(source))("is byte-identical to ../cyber-brain/scripts/core.mjs (pnpm sync:cyber-brain)", () => {
    expect(readFileSync(vendored, "utf8")).toBe(readFileSync(source, "utf8"));
  });

  it("loads and round-trips the kit formats", () => {
    const fact = formatFact("Pro costs 39", { source: "chat", since: "2026-11-07", was: "Pro costs 29" });
    expect(fact).toBe("- Pro costs 39 [source: chat; since: 2026-11-07; was: Pro costs 29]");
    expect(parseFact(fact)?.meta.was).toBe("Pro costs 29");
    const transit = formatTransit("fact", "x", "People/Anna.md", "chat", "2026-11-07");
    expect(parseTransit(transit)).toMatchObject({ kind: "fact", target: "People/Anna.md" });
  });
});
