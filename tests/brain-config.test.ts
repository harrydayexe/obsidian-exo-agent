import { describe, it, expect } from "vitest";
import { DEFAULT_BRAIN, dailyNoteFor, parseBrainConfig, readBrainConfig } from "../src/core/brain-config";

const AGENTS = `---
cyber_brain: "0.1"
owner: Ada
writers: direct
daily_notes: Journal/YYYY-MM-DD.md
daily_heading: "### Run log"
paths:
  system: Brain
  inbox: _inbox
---

# AGENTS.md
`;

describe("parseBrainConfig", () => {
  it("reads the system folder, writers, daily note pattern and heading", () => {
    expect(parseBrainConfig(AGENTS)).toEqual({
      system: "Brain",
      writers: "direct",
      dailyNotes: "Journal/YYYY-MM-DD.md",
      dailyHeading: "### Run log",
    });
  });

  it("applies the spec defaults to a cyber-brain file that leaves them out", () => {
    const cfg = parseBrainConfig('---\ncyber_brain: "0.1"\nowner: Ada\n---\n');
    expect(cfg).toEqual({ system: "System", writers: "inbox", dailyNotes: "", dailyHeading: "### Agents" });
  });

  it("treats a missing file or a plain AGENTS.md as a vault with no brain: System, direct writes", () => {
    expect(parseBrainConfig(null)).toBe(DEFAULT_BRAIN);
    expect(parseBrainConfig("# AGENTS.md\n\nplain notes\n")).toBe(DEFAULT_BRAIN);
    expect(parseBrainConfig("---\nowner: Ada\n---\n")).toBe(DEFAULT_BRAIN);
    expect(DEFAULT_BRAIN.writers).toBe("direct");
  });

  it("trims slashes around paths.system", () => {
    expect(parseBrainConfig('---\ncyber_brain: "0.1"\npaths:\n  system: /Brain/\n---\n').system).toBe("Brain");
  });
});

describe("readBrainConfig", () => {
  it("reads AGENTS.md through the injected reader and survives a failing one", async () => {
    expect((await readBrainConfig(async (p) => (p === "AGENTS.md" ? AGENTS : null))).system).toBe("Brain");
    expect(await readBrainConfig(async () => null)).toBe(DEFAULT_BRAIN);
    expect(
      await readBrainConfig(async () => {
        throw new Error("no adapter");
      }),
    ).toBe(DEFAULT_BRAIN);
  });
});

describe("dailyNoteFor", () => {
  it("fills the date tokens", () => {
    expect(dailyNoteFor("Journal/YYYY-MM-DD.md", new Date(2026, 10, 7))).toBe("Journal/2026-11-07.md");
  });
  it("is empty when the vault has no daily notes", () => {
    expect(dailyNoteFor("", new Date())).toBe("");
  });
});
