import { describe, it, expect } from "vitest";
import { exoPaths, DEFAULT_MEMORY_ROOT } from "../src/core/paths";

describe("exoPaths", () => {
  it("lays every path out as the cyber-brain spec does", () => {
    const p = exoPaths("System");
    expect(p.root).toBe("System");
    expect(p.memory).toBe("System/memory");
    expect(p.agentDir).toBe("System/identity");
    expect(p.observations).toBe("System/identity/observations.md");
    expect(p.openLoops).toBe("System/memory/loops.md");
    expect(p.inbox).toBe("System/memory/inbox/exo");
    expect(p.agentRuns).toBe("System/runs");
    expect(p.agentMemory).toBe("System/memory/agents");
    expect(p.rules).toBe("System/memory/rules");
    expect(p.decisions).toBe("System/memory/decisions");
  });

  it("reads the vault entry point from AGENTS.md at the vault root", () => {
    expect(exoPaths("System").vaultContext).toBe("AGENTS.md");
    expect(exoPaths("Brain").vaultContext).toBe("AGENTS.md");
  });

  it("keeps Exo's own folders under the same root", () => {
    const p = exoPaths("System");
    expect(p.queue).toBe("System/exo-queue");
    expect(p.review).toBe("System/review.md");
    expect(p.agents).toBe("System/agents");
    expect(p.workflowSignals).toBe("System/memory/workflow-signals.json");
  });

  it("keeps the agent identity layer and the agent registry distinct", () => {
    const p = exoPaths("System");
    expect(p.agentDir).not.toBe(p.agents); // `identity/` = persona blocks, `agents/` = the registry
  });

  it("follows a root the vault's AGENTS.md names", () => {
    const p = exoPaths("Brain");
    expect(p.inbox).toBe("Brain/memory/inbox/exo");
    expect(p.agentRuns).toBe("Brain/runs");
  });

  it("falls back to the spec's root on empty input", () => {
    expect(DEFAULT_MEMORY_ROOT).toBe("System");
    expect(exoPaths("").root).toBe("System");
  });

  it("trims trailing slashes from a user-entered root", () => {
    expect(exoPaths("MyMemory/").memory).toBe("MyMemory/memory");
  });
});
