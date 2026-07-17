import initWasm, { parse_plan } from "./wasm/planscope_parser.js";
import type { Engine } from "./engine";
import type { PlanNode } from "./plan";

let ready: Promise<void> | undefined;

/** Loads and instantiates the wasm module. Safe to call more than once - the
 * underlying wasm-bindgen init() is cached, and so is this wrapper's promise. */
export function ensureParserReady(): Promise<void> {
  if (!ready) {
    ready = initWasm().then(() => undefined);
  }
  return ready;
}

/**
 * Parses `text` as an EXPLAIN plan for `engine`. Must run after
 * ensureParserReady() resolves. Throws a plain Error with a
 * human-readable message on malformed input - the wasm side throws a
 * bare string, not an Error instance, so that gets normalized here.
 */
export function parsePlan(engine: Engine, text: string): PlanNode {
  try {
    return parse_plan(engine, text) as PlanNode;
  } catch (cause) {
    const message = typeof cause === "string" ? cause : String(cause);
    throw new Error(message);
  }
}
