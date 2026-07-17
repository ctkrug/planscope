import { describe, expect, it } from "vitest";
import { engineLabel, isEngine } from "./engine";

describe("isEngine", () => {
  it("accepts the three supported engines", () => {
    expect(isEngine("postgres")).toBe(true);
    expect(isEngine("mysql")).toBe(true);
    expect(isEngine("sqlite")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isEngine("oracle")).toBe(false);
    expect(isEngine("")).toBe(false);
  });
});

describe("engineLabel", () => {
  it("returns a human-readable name for each engine", () => {
    expect(engineLabel("postgres")).toBe("PostgreSQL");
    expect(engineLabel("mysql")).toBe("MySQL");
    expect(engineLabel("sqlite")).toBe("SQLite");
  });
});
