import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn(async () => undefined);
const parse_plan = vi.fn();

vi.mock("./wasm/planscope_parser.js", () => ({
  default: init,
  parse_plan,
}));

describe("parsePlan", () => {
  beforeEach(() => {
    init.mockClear();
    parse_plan.mockReset();
  });

  it("returns the parsed tree on success", async () => {
    const { parsePlan } = await import("./parser");
    parse_plan.mockReturnValue({ node_type: "Seq Scan", children: [] });

    const plan = parsePlan("postgres", "Seq Scan on t");

    expect(plan.node_type).toBe("Seq Scan");
    expect(parse_plan).toHaveBeenCalledWith("postgres", "Seq Scan on t");
  });

  it("wraps a thrown string into an Error with the same message", async () => {
    const { parsePlan } = await import("./parser");
    parse_plan.mockImplementation(() => {
      throw "no plan lines found";
    });

    expect(() => parsePlan("postgres", "")).toThrow("no plan lines found");
    expect(() => parsePlan("postgres", "")).toThrow(Error);
  });

  it("stringifies a non-string thrown value instead of losing it", async () => {
    const { parsePlan } = await import("./parser");
    parse_plan.mockImplementation(() => {
      // The wasm boundary is documented to throw bare strings, but nothing
      // in the type system enforces that - a future wasm-bindgen version
      // (or a browser runtime error) could throw something else.
      throw { code: "OOM" };
    });

    expect(() => parsePlan("postgres", "")).toThrow(Error);
    expect(() => parsePlan("postgres", "")).toThrow("[object Object]");
  });

  it("ensureParserReady only initializes the wasm module once", async () => {
    const { ensureParserReady } = await import("./parser");

    await ensureParserReady();
    await ensureParserReady();

    expect(init).toHaveBeenCalledTimes(1);
  });
});
