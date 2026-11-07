import { describe, it, expect } from "vitest";
import {
  formatLoop,
  parseLoopsFile,
  activeLoops,
  dueLoops,
  closeLoop,
  uniqueLoopId,
  writeLoops,
  LOOPS_FILE_HEADER,
  type LoopEntry,
} from "../src/core/open-loops";
import { parseLoops } from "../src/vendor/cyber-brain/core.mjs";

const T = Date.UTC(2024, 6, 3, 0, 0, 0); // 2024-07-03, the day precision `opened:` keeps

/** A loop as it reads back from disk: `state` is always written, so it is always parsed. */
function loop(over: Partial<LoopEntry> = {}): LoopEntry {
  const status = over.status ?? "open";
  return {
    id: `loop-${T}`,
    title: "Follow up with Marco",
    note: "He asked for the pricing deck by Friday.",
    openedAt: T,
    status,
    state: status === "closed" ? "closed" : status === "waiting-user" ? "waiting for the user" : "open",
    ...over,
  };
}

describe("formatLoop / parseLoopsFile round-trip", () => {
  it("round-trips a minimal open loop (no resurface, tags, owner)", () => {
    const e = loop();
    const parsed = parseLoopsFile(formatLoop(e));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(e);
  });

  it("round-trips resurface, tags, owner, state and a waiting-user status", () => {
    const e = loop({
      resurface: "2024-08-01",
      tags: ["career", "outreach"],
      status: "waiting-user",
      owner: "user",
      state: "waiting for the pricing numbers",
    });
    const parsed = parseLoopsFile(formatLoop(e));
    expect(parsed[0]).toEqual(e);
  });

  it("omits resurface/tags/owner lines when absent", () => {
    const block = formatLoop(loop());
    expect(block).not.toContain("resurface:");
    expect(block).not.toContain("tags:");
    expect(block).not.toContain("owner:");
  });

  it("writes the kit's fields in the kit's order, with one state line", () => {
    const block = formatLoop(loop({ resurface: "2024-08-01", status: "waiting-user", owner: "user", state: "waiting", tags: ["x"] }));
    expect(block.split("\n").slice(0, 8)).toEqual([
      "## loop-1719964800000",
      "- title: Follow up with Marco",
      "- opened: 2024-07-03",
      "- resurface: 2024-08-01",
      "- status: waiting-user",
      "- owner: user",
      "- state: waiting",
      "- tags: x",
    ]);
  });

  it("is read by the kit's own parser", () => {
    const [kit] = parseLoops(formatLoop(loop({ status: "waiting-user", owner: "user", state: "waiting" })));
    expect(kit.fields).toMatchObject({ status: "waiting-user", owner: "user", state: "waiting", opened: "2024-07-03" });
    expect(kit.stateLines).toBe(1);
  });

  it("gives a loop with no state a state that matches its status", () => {
    expect(formatLoop(loop({ status: "closed" }))).toContain("- state: closed");
    expect(formatLoop(loop())).toContain("- state: open");
  });

  it("keeps waiting-user through a parse and a rewrite (it used to flatten to open)", () => {
    const src = formatLoop(loop({ status: "waiting-user", owner: "user", state: "waiting" }));
    expect(parseLoopsFile(src)[0].status).toBe("waiting-user");
    expect(writeLoops(src, parseLoopsFile(src))).toBe(`${src}\n`);
  });

  it("preserves multi-line verbatim note including internal blank lines", () => {
    const e = loop({ note: "line one\n\n- a bullet\n- another\n\nfinal para" });
    const parsed = parseLoopsFile(formatLoop(e));
    expect(parsed[0].note).toBe(e.note);
  });

  it("round-trips several entries concatenated into one file", () => {
    const a = loop({ id: "loop-1", openedAt: T, note: "first" });
    const b = loop({ id: "loop-2", openedAt: T + 86_400_000, note: "second\nmore", tags: ["x"] });
    const file = [formatLoop(a), formatLoop(b)].join("\n\n");
    expect(parseLoopsFile(file)).toEqual([a, b]);
  });

  it("falls back to the id-embedded epoch when the opened: line is missing", () => {
    const file = `## loop-42\n- title: untitled\n- status: open\n\nhello`;
    const parsed = parseLoopsFile(file);
    expect(parsed[0].openedAt).toBe(42);
  });
});

describe("parseLoopsFile, junk tolerance", () => {
  it("ignores leading prose and hand-edited garbage between blocks, recovers every real block", () => {
    const a = loop({ id: "loop-1", openedAt: 1, note: "first" });
    const b = loop({ id: "loop-2", openedAt: 2, note: "second" });
    const file =
      "# a human heading someone typed\n\nsome loose prose I jotted down\n\n" +
      formatLoop(a) +
      "\n\nrandom junk line that isn't a block\n- not-a-real-key: whatever\n\n" +
      formatLoop(b) +
      "\n\ntrailing junk\n";
    const parsed = parseLoopsFile(file);
    // Leading prose is ignored; both real blocks are recovered with correct ids.
    // Junk between blocks has no terminator of its own, so, same tolerant-parsing
    // contract as `memory-store.ts`, it's absorbed into the preceding block's note.
    expect(parsed.map((e) => e.id)).toEqual(["loop-1", "loop-2"]);
    expect(parsed[0].note.startsWith("first")).toBe(true);
    expect(parsed[1].note.startsWith("second")).toBe(true);
  });

  it("never throws on a totally malformed file", () => {
    expect(() => parseLoopsFile("not even close to a loop block\n---\nrandom")).not.toThrow();
    expect(parseLoopsFile("not even close to a loop block\n---\nrandom")).toEqual([]);
  });

  it("defaults status to open when the status line is missing or garbage", () => {
    const missing = parseLoopsFile(`## loop-5\n- title: x\n- opened: 2024-01-01T00:00:00.000Z\n\nbody`);
    expect(missing[0].status).toBe("open");
    const garbage = parseLoopsFile(
      `## loop-6\n- title: x\n- opened: 2024-01-01T00:00:00.000Z\n- status: banana\n\nbody`
    );
    expect(garbage[0].status).toBe("open");
  });
});

describe("dueLoops, tickler / timezone-safe local-date logic", () => {
  it("a loop with no resurface date is due immediately", () => {
    const e = loop();
    expect(dueLoops([e], T)).toEqual([e]);
  });

  it("excludes a loop whose resurface date is in the future", () => {
    const e = loop({ resurface: "2099-01-01" });
    expect(dueLoops([e], T)).toEqual([]);
  });

  it("includes a loop whose resurface date is today (local-date boundary, inclusive)", () => {
    const now = new Date(2024, 6, 15, 9, 30); // local 2024-07-15 09:30
    const e = loop({ resurface: "2024-07-15" });
    expect(dueLoops([e], now)).toEqual([e]);
  });

  it("is timezone-safe: due regardless of time-of-day, as long as the local calendar day matches", () => {
    const lateNight = new Date(2024, 6, 15, 23, 59);
    const earlyMorning = new Date(2024, 6, 15, 0, 1);
    const e = loop({ resurface: "2024-07-15" });
    expect(dueLoops([e], lateNight)).toEqual([e]);
    expect(dueLoops([e], earlyMorning)).toEqual([e]);
  });

  it("includes a loop whose resurface date is in the past", () => {
    const now = new Date(2024, 6, 15);
    const e = loop({ resurface: "2024-01-01" });
    expect(dueLoops([e], now)).toEqual([e]);
  });

  it("excludes closed loops regardless of resurface date", () => {
    const now = new Date(2024, 6, 15);
    const e = loop({ resurface: "2020-01-01", status: "closed" });
    expect(dueLoops([e], now)).toEqual([]);
  });
});

describe("activeLoops", () => {
  it("returns every loop not closed: open and waiting-user", () => {
    const open = loop({ id: "loop-1" });
    const waiting = loop({ id: "loop-3", status: "waiting-user" });
    const closed = loop({ id: "loop-2", status: "closed" });
    expect(activeLoops([open, waiting, closed])).toEqual([open, waiting]);
  });
});

describe("closeLoop, append-only close semantics", () => {
  it("flips status to closed and dates the state, preserving the original note when no outcome is given", () => {
    const e = loop();
    const [closed] = closeLoop([e], e.id, undefined, T + 5000);
    expect(closed.status).toBe("closed");
    expect(closed.state).toBe("closed 2024-07-03");
    expect(closed.note).toBe(e.note);
    expect(closed.id).toBe(e.id);
    expect(closed.title).toBe(e.title);
    expect(closed.openedAt).toBe(e.openedAt);
  });

  it("appends the outcome to the note without discarding the original content", () => {
    const e = loop();
    const [closed] = closeLoop([e], e.id, "Sent the deck, he replied thanks.", T + 5000);
    expect(closed.note).toContain(e.note);
    expect(closed.note).toContain("Outcome 2024-07-03: Sent the deck, he replied thanks.");
    expect(closed.state).toBe("closed 2024-07-03: Sent the deck, he replied thanks.");
    expect(closed.owner).toBe(e.owner);
  });

  it("leaves other entries in the list untouched", () => {
    const a = loop({ id: "loop-1" });
    const b = loop({ id: "loop-2", title: "Other loop" });
    const result = closeLoop([a, b], "loop-1", undefined, T + 5000);
    const untouched = result.find((r) => r.id === "loop-2");
    expect(untouched).toEqual(b);
  });

  it("throws when the id does not exist (never silently deletes/loses data)", () => {
    const e = loop();
    expect(() => closeLoop([e], "loop-does-not-exist")).toThrow();
  });

  it("round-trips through format/parse after closing", () => {
    const e = loop();
    const [closed] = closeLoop([e], e.id, "done", T + 5000);
    const parsed = parseLoopsFile(formatLoop(closed));
    expect(parsed[0]).toEqual(closed);
  });
});

describe("slug ids (hand-written ledger entries)", () => {
  const MIXED = [
    "## loop-1788728477410",
    "- title: Numeric one",
    "- opened: 2026-09-06T21:01:17.410Z",
    "- status: open",
    "- resurface: 2026-09-15",
    "",
    "Numeric body.",
    "",
    "## loop-2026-09-08-clubjoy-14-set",
    "- title: Slug one",
    "- opened: 2026-09-08",
    "- status: open",
    "- resurface: 2026-09-24",
    "- tags: domain/career",
    "",
    "Slug body, see `loop-2026-09-11-scommessa-clubjoy`.",
    "",
    "## loop-turno-init",
    "- title: Pure slug",
    "- opened: 2026-10-03",
    "- status: closed",
    "",
    "Closed by hand.",
    "",
    "## loop-1791892899904",
    "- title: Numeric again",
    "- opened: 2026-10-13T12:01:39.904Z",
    "- status: open",
    "",
    "Last body.",
    "",
  ].join("\n");

  it("a slug-id loop after a numeric one is its own loop and does not leak into the numeric body", () => {
    const parsed = parseLoopsFile(MIXED);
    expect(parsed[0].id).toBe("loop-1788728477410");
    expect(parsed[0].note).toBe("Numeric body.");
    expect(parsed[1].id).toBe("loop-2026-09-08-clubjoy-14-set");
    expect(parsed[1].title).toBe("Slug one");
    expect(parsed[1].note).toBe("Slug body, see `loop-2026-09-11-scommessa-clubjoy`.");
  });

  it("counts every loop in a mixed ledger, in order", () => {
    const parsed = parseLoopsFile(MIXED);
    expect(parsed.map((e) => e.id)).toEqual([
      "loop-1788728477410",
      "loop-2026-09-08-clubjoy-14-set",
      "loop-turno-init",
      "loop-1791892899904",
    ]);
    expect(activeLoops(parsed)).toHaveLength(3);
  });

  it("accepts a date-only opened: value", () => {
    const parsed = parseLoopsFile(MIXED);
    expect(parsed[1].openedAt).toBe(Date.parse("2026-09-08"));
    expect(parsed[2].openedAt).toBe(Date.parse("2026-10-03"));
    expect(parsed[1].resurface).toBe("2026-09-24");
    expect(parsed[2].status).toBe("closed");
  });

  it("close_loop by slug id closes only that loop and keeps the rest", () => {
    const closed = closeLoop(parseLoopsFile(MIXED), "loop-2026-09-08-clubjoy-14-set", "done", Date.UTC(2026, 9, 25));
    expect(closed).toHaveLength(4);
    expect(closed[1].status).toBe("closed");
    expect(closed[1].note).toContain("Outcome 2026-10-25: done");
    expect(closed[1].state).toBe("closed 2026-10-25: done");
    expect(closed[0].status).toBe("open");
    expect(closed[3].status).toBe("open");
  });

  it("dueLoops sees slug loops", () => {
    const due = dueLoops(parseLoopsFile(MIXED), new Date(2026, 9, 25));
    expect(due.map((e) => e.id)).toEqual([
      "loop-1788728477410",
      "loop-2026-09-08-clubjoy-14-set",
      "loop-1791892899904",
    ]);
  });

  it("a numeric-only ledger keeps its output", () => {
    const a = loop({ id: "loop-1", title: "A", note: "one" });
    const b = loop({ id: "loop-2", title: "B", note: "two", status: "closed" });
    const text = [a, b].map(formatLoop).join("\n\n") + "\n";
    const parsed = parseLoopsFile(text);
    expect(parsed).toEqual([a, b]);
    expect(parsed.map(formatLoop).join("\n\n") + "\n").toBe(text);
  });

  it("does not treat non-loop level-2 headings as loop headers", () => {
    const parsed = parseLoopsFile(`${formatLoop(loop())}\n\n## Notes\nplain heading body\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].note).toContain("## Notes");
  });
});

describe("ledger fidelity: the writer never rewrites what the source wrote", () => {
  const LEDGER = [
    "## loop-1788728477410",
    "- title: Numeric one",
    "- opened: 2026-09-06T21:01:17.410Z",
    "- status: open",
    "- resurface: 2026-09-15",
    "- tags: domain/identity, type/content",
    "",
    "Numeric body.",
    "",
    "Stato: ancora da autenticare [dal: 2026-09-24].",
    "",
    "## loop-2026-09-08-clubjoy-14-set",
    "- title: Slug, date-only opened",
    "- opened: 2026-09-08",
    "- status: open",
    "- resurface: 2026-09-24",
    "- tags: domain/career",
    "",
    "Collegato a `loop-2026-09-11-scommessa-clubjoy`.",
    "",
    "Stato: esito non catturato [dal: 2026-09-24].",
    "",
    "## loop-2026-10-03-turno-init",
    "- title: Closed by hand, no closed line",
    "- opened: 2026-10-03",
    "- status: closed",
    "- resurface: 2026-10-19",
    "",
    "Corpo.",
    "Stato: chiuso [fonte: Mario; dal: 2026-10-25].",
    "",
    "## loop-2026-10-12-hand-date",
    "- title: Unparseable hand-written date",
    "- opened: 3 ott 2026",
    "- status: open",
    "",
    "<!-- exo-proposal:proposal-1792596922408-s5s8ka -->",
    "Body with a proposal marker.",
    "",
    "## loop-2026-10-13-no-opened",
    "- title: No opened line at all",
    "- status: open",
    "",
    "Body.",
    "",
  ].join("\n");

  const write = (es: LoopEntry[], source = LEDGER) => writeLoops(source, es);

  it("a no-op write is byte-identical", () => {
    expect(write(parseLoopsFile(LEDGER))).toBe(LEDGER);
  });

  it("keeps a date-only opened as written, and never invents an ISO line", () => {
    const out = write(parseLoopsFile(LEDGER));
    expect(out).toContain("- opened: 2026-09-08\n");
    expect(out).toContain("- opened: 3 ott 2026\n");
    expect(out).not.toContain("1970");
    const noOpened = out.split("## loop-2026-10-13-no-opened")[1];
    expect(noOpened).not.toContain("opened:");
  });

  it("derives openedAt from a loop-YYYY-MM-DD id when opened is unusable", () => {
    const parsed = parseLoopsFile(LEDGER);
    expect(parsed[3].openedAt).toBe(Date.parse("2026-10-12"));
    expect(parsed[4].openedAt).toBe(Date.parse("2026-10-13"));
  });

  it("closing one loop changes only that block", () => {
    const before = LEDGER.split("\n\n## ");
    const closed = write(closeLoop(parseLoopsFile(LEDGER), "loop-2026-09-08-clubjoy-14-set", "done", T));
    const after = closed.split("\n\n## ");
    expect(after).toHaveLength(before.length);
    const changed = before.map((b, i) => (b === after[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toEqual([1]);
    expect(after[1]).toContain("- status: closed");
    expect(after[1]).toContain("- opened: 2026-09-08\n");
  });

  it("a new loop appended by code gets a date opened line and the kit fields, and leaves the rest byte-identical", () => {
    const fresh = loop({ id: "loop-new", openedAt: Date.UTC(2026, 9, 26), owner: "user" });
    const out = write([...parseLoopsFile(LEDGER), fresh]);
    expect(out.startsWith(LEDGER.trimEnd())).toBe(true);
    expect(out).toContain("- opened: 2026-10-26\n- status: open\n- owner: user\n- state: open");
  });

  it("keeps what precedes the first loop: frontmatter and heading", () => {
    const file = `${LOOPS_FILE_HEADER}\n${formatLoop(loop())}\n`;
    const closed = writeLoops(file, closeLoop(parseLoopsFile(file), loop().id, "done", T));
    expect(closed.startsWith(LOOPS_FILE_HEADER)).toBe(true);
    expect(closed).toContain("- status: closed");
    expect(writeLoops(LOOPS_FILE_HEADER, [loop()]).startsWith(LOOPS_FILE_HEADER)).toBe(true);
  });

  it("unknown metadata lines do not end the run: a later status is read, and the lines are kept once", () => {
    const src = [
      "## loop-2026-10-20-extra",
      "- title: Has extra keys",
      "- opened: 2026-10-20",
      "- owner: mario",
      "- status: closed",
      "- resurface: 2026-10-30",
      "- priority: high",
      "",
      "Body.",
      "",
    ].join("\n");
    const [e] = parseLoopsFile(src);
    expect(e.status).toBe("closed");
    expect(e.resurface).toBe("2026-10-30");
    const out = write([e], src);
    expect(out.match(/^- owner: mario$/gm)).toHaveLength(1);
    expect(out.match(/^- priority: high$/gm)).toHaveLength(1);
    expect(out.match(/^## loop-2026-10-20-extra$/gm)).toHaveLength(1);
    expect(parseLoopsFile(out)[0]).toEqual(e);
  });
});

describe("uniqueLoopId", () => {
  it("is loop-<slug of the title>", () => {
    expect(uniqueLoopId("Follow up: Marco's deck!", [])).toBe("loop-follow-up-marco-s-deck");
  });
  it("adds a numeric suffix while the ledger already has the id", () => {
    expect(uniqueLoopId("Call Anna", ["loop-call-anna"])).toBe("loop-call-anna-2");
    expect(uniqueLoopId("Call Anna", ["loop-call-anna", "loop-call-anna-2"])).toBe("loop-call-anna-3");
  });
});
