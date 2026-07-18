import { describe, expect, it } from "vitest";
import {
  describeNodeFields,
  findHottestNode,
  findHottestNodePath,
  isRowEstimateMismatch,
  pathKey,
  selfTimeMs,
  type PlanNode,
} from "./plan";

function node(partial: Partial<PlanNode>): PlanNode {
  return { node_type: "Node", children: [], ...partial };
}

describe("selfTimeMs", () => {
  it("is undefined when there is no ANALYZE data", () => {
    expect(selfTimeMs(node({}))).toBeUndefined();
  });

  it("equals total time for a leaf node", () => {
    expect(selfTimeMs(node({ actual_time_total_ms: 12.5 }))).toBe(12.5);
  });

  it("subtracts children's total time from the parent's total", () => {
    const parent = node({
      actual_time_total_ms: 10,
      children: [
        node({ actual_time_total_ms: 4 }),
        node({ actual_time_total_ms: 3 }),
      ],
    });
    expect(selfTimeMs(parent)).toBe(3);
  });

  it("treats children with no ANALYZE data as zero, not undefined", () => {
    const parent = node({
      actual_time_total_ms: 10,
      children: [node({})],
    });
    expect(selfTimeMs(parent)).toBe(10);
  });

  it("never returns negative self-time from inconsistent input", () => {
    const parent = node({
      actual_time_total_ms: 5,
      children: [node({ actual_time_total_ms: 9 })],
    });
    expect(selfTimeMs(parent)).toBe(0);
  });
});

describe("findHottestNode", () => {
  it("returns undefined when no node has ANALYZE data", () => {
    expect(findHottestNode(node({ children: [node({})] }))).toBeUndefined();
  });

  it("finds the single node with the highest self-time, several levels deep", () => {
    const hot = node({ node_type: "Seq Scan", actual_time_total_ms: 90 });
    const root = node({
      actual_time_total_ms: 100,
      children: [
        node({
          actual_time_total_ms: 95,
          children: [hot],
        }),
      ],
    });
    expect(findHottestNode(root)).toBe(hot);
  });

  it("picks the root when it is the only node with ANALYZE data", () => {
    const root = node({ actual_time_total_ms: 5 });
    expect(findHottestNode(root)).toBe(root);
  });
});

describe("isRowEstimateMismatch", () => {
  it("is false when ANALYZE data is missing", () => {
    expect(isRowEstimateMismatch(node({ estimated_rows: 10 }))).toBe(false);
    expect(isRowEstimateMismatch(node({ actual_rows: 10 }))).toBe(false);
  });

  it("is false when estimate and actual are close", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 100, actual_rows: 150 })),
    ).toBe(false);
  });

  it("is true when actual exceeds estimate by more than 10x", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 10, actual_rows: 12400 })),
    ).toBe(true);
  });

  it("is true when estimate exceeds actual by more than 10x", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 50000, actual_rows: 2 })),
    ).toBe(true);
  });

  it("handles a zero estimate without dividing by zero", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 0, actual_rows: 5 })),
    ).toBe(true);
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 0, actual_rows: 0 })),
    ).toBe(false);
  });

  it("is true exactly at the 10x threshold in either direction (inclusive boundary)", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 10, actual_rows: 100 })),
    ).toBe(true);
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 100, actual_rows: 10 })),
    ).toBe(true);
  });

  it("is false just inside the 10x threshold in either direction", () => {
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 10, actual_rows: 99 })),
    ).toBe(false);
    expect(
      isRowEstimateMismatch(node({ estimated_rows: 100, actual_rows: 11 })),
    ).toBe(false);
  });
});

describe("findHottestNodePath", () => {
  it("returns undefined when no node has ANALYZE data", () => {
    expect(findHottestNodePath(node({ children: [node({})] }))).toBeUndefined();
  });

  it("returns an empty path when the root itself is hottest", () => {
    expect(findHottestNodePath(node({ actual_time_total_ms: 5 }))).toEqual([]);
  });

  it("finds the path to the hottest node several levels deep", () => {
    const hot = node({ node_type: "Seq Scan on b", actual_time_total_ms: 90 });
    const root = node({
      actual_time_total_ms: 100,
      children: [
        node({ actual_time_total_ms: 2 }),
        node({
          actual_time_total_ms: 95,
          children: [node({ actual_time_total_ms: 1 }), hot],
        }),
      ],
    });
    expect(findHottestNodePath(root)).toEqual([1, 1]);
  });
});

describe("pathKey", () => {
  it("joins a path into a dotted string", () => {
    expect(pathKey([0, 1, 2])).toBe("0.1.2");
  });

  it("encodes the root path as an empty string", () => {
    expect(pathKey([])).toBe("");
  });
});

describe("describeNodeFields", () => {
  it("always includes node_type and a children count", () => {
    expect(describeNodeFields(node({ node_type: "Hash" }))).toEqual([
      { label: "Node type", value: "Hash" },
      { label: "Children", value: "0" },
    ]);
  });

  it("includes every present field, formatted for display", () => {
    const fields = describeNodeFields(
      node({
        node_type: "Seq Scan",
        relation: "users",
        estimated_cost_start: 0,
        estimated_cost_total: 35.5,
        estimated_rows: 2550,
        actual_time_start_ms: 0.01,
        actual_time_total_ms: 0.41,
        actual_rows: 2550,
        actual_loops: 1,
      }),
    );
    expect(fields).toEqual([
      { label: "Node type", value: "Seq Scan" },
      { label: "Relation", value: "users" },
      { label: "Estimated cost (start)", value: "0" },
      { label: "Estimated cost (total)", value: "35.5" },
      { label: "Estimated rows", value: "2,550" },
      { label: "Actual time (start)", value: "0.01 ms" },
      { label: "Actual time (total)", value: "0.41 ms" },
      { label: "Actual rows", value: "2,550" },
      { label: "Actual loops", value: "1" },
      { label: "Children", value: "0" },
    ]);
  });

  it("omits absent fields rather than showing a placeholder", () => {
    const fields = describeNodeFields(node({ node_type: "Hash", estimated_rows: 10 }));
    expect(fields.map((f) => f.label)).toEqual(["Node type", "Estimated rows", "Children"]);
  });
});
