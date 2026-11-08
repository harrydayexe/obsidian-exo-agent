// Types for the vendored cyber-brain core. The implementation is
// core.mjs, copied byte for byte by scripts/sync-cyber-brain.mjs.

export const LIMITS: Record<string, number>;
export const AGENT_MEMORY_LIMIT: number;
export const SUMMARY_MAX: number;
export const FACT_KEYS: readonly ["source", "since", "until", "was", "confidence"];
export const TRANSIT_KINDS: readonly ["fact", "loop", "decision", "block", "observation", "skill"];
export const LOOP_STATUS: readonly ["open", "waiting-user", "closed"];

export type LoopStatus = (typeof LOOP_STATUS)[number];
export type TransitKind = (typeof TRANSIT_KINDS)[number];

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}
export function parseFrontmatter(text: string): Frontmatter;

export interface FactMeta {
  source?: string;
  since?: string;
  until?: string;
  was?: string;
  confidence?: string;
}
export interface ParsedFact {
  text: string;
  meta: FactMeta & Record<string, string>;
  order: string[];
  error: string | null;
}
export function parseFact(line: string): ParsedFact | null;
export function trueOn(fact: { meta: FactMeta }, date: string): boolean;
export function formatFact(text: string, meta: FactMeta): string;
export function closeFactLine(line: string, until: string): string | null;

export interface TransitEntry {
  kind: string;
  text: string;
  target: string;
  meta: FactMeta;
}
export function formatTransit(
  kind: TransitKind,
  text: string,
  target: string | undefined,
  source: string,
  since: string,
  was?: string,
): string;
export function parseTransit(line: string): TransitEntry | null;

export interface ParsedLoop {
  id: string;
  fields: Record<string, string>;
  stateLines: number;
}
export function parseLoops(text: string): ParsedLoop[];
export function formatLoop(loop: {
  id: string;
  title: string;
  opened: string;
  resurface?: string;
  status?: LoopStatus;
  owner?: string;
  state?: string;
  context?: string;
}): string;

export interface ParsedRun {
  header: string;
  fields: Record<string, string>;
  writes: string[];
}
export function parseRuns(text: string): ParsedRun[];

export function oneLine(s: unknown): string;
export function slugify(s: string, max?: number): string;
