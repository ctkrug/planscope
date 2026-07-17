import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanNode } from "./plan";

const ensureParserReady = vi.fn(async () => undefined);
const parsePlan = vi.fn<(engine: string, text: string) => PlanNode>();

vi.mock("./parser", () => ({
  ensureParserReady,
  parsePlan,
}));

async function setup() {
  const { renderApp } = await import("./main");
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app")!;
  renderApp(root);
  return {
    root,
    textarea: root.querySelector<HTMLTextAreaElement>("#plan-input")!,
    button: root.querySelector<HTMLButtonElement>("#visualize-btn")!,
    output: root.querySelector<HTMLElement>("#output-content")!,
    error: root.querySelector<HTMLElement>("#input-error")!,
    railBody: root.querySelector<HTMLElement>("#input-rail-body")!,
    jumpButton: root.querySelector<HTMLButtonElement>("#jump-hottest-btn")!,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("renderApp", () => {
  beforeEach(() => {
    ensureParserReady.mockClear();
    parsePlan.mockReset();
  });

  it("shows an inline error and never calls the parser when the input is empty", async () => {
    const { button, output, error } = await setup();

    button.click();

    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("Paste a plan first.");
    expect(output.textContent).toContain("Paste a plan first.");
    expect(parsePlan).not.toHaveBeenCalled();
  });

  it("renders the cost tree and collapses the input rail on a successful parse", async () => {
    const { textarea, button, output, railBody } = await setup();
    textarea.value = "Seq Scan on users (cost=0.00..1.00 rows=1 width=4)";
    parsePlan.mockReturnValue({ node_type: "Seq Scan", relation: "users", children: [] });

    button.click();
    await flush();

    expect(output.querySelector(".tree")).not.toBeNull();
    expect(output.querySelector(".tree-label")?.textContent).toBe("Seq Scan on users");
    expect(railBody.hidden).toBe(true);
  });

  it("surfaces a parse failure as a styled inline error, not a thrown exception", async () => {
    const { textarea, button, output, error } = await setup();
    textarea.value = "not a real plan";
    parsePlan.mockImplementation(() => {
      throw new Error("no plan lines found");
    });

    button.click();
    await flush();

    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("no plan lines found");
    expect(output.querySelector(".output-placeholder-error")?.textContent).toBe(
      "no plan lines found",
    );
  });

  it("renders a parser error message as plain text, never as markup", async () => {
    const { textarea, button, output } = await setup();
    textarea.value = "bad input";
    parsePlan.mockImplementation(() => {
      throw new Error("bad node id in row: <img src=x onerror=alert(1)>");
    });

    button.click();
    await flush();

    expect(output.querySelector("img")).toBeNull();
    expect(output.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("lets the input rail be manually collapsed and expanded", async () => {
    const { root, railBody } = await setup();
    const toggle = root.querySelector<HTMLButtonElement>("#toggle-input")!;

    toggle.click();
    expect(railBody.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(railBody.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens the node inspector when a tree row is clicked", async () => {
    const { root, textarea, button, output } = await setup();
    textarea.value = "Seq Scan on users (cost=0.00..1.00 rows=1 width=4)";
    parsePlan.mockReturnValue({ node_type: "Seq Scan", relation: "users", children: [] });

    button.click();
    await flush();

    output.querySelector<HTMLElement>(".tree-row")!.click();

    const panel = root.querySelector(".inspector-panel")!;
    expect(panel.textContent).toContain("Seq Scan on users");
    const backdrop = root.querySelector<HTMLElement>(".inspector-backdrop")!;
    expect(backdrop.hidden).toBe(false);
  });

  it("shows a jump-to-hottest button when the plan has ANALYZE data, and it focuses the hottest row", async () => {
    const { textarea, button, output, jumpButton } = await setup();
    textarea.value = "Hash Join (actual time=0.50..10.00 rows=10 loops=1)";
    const hot = { node_type: "Seq Scan on b", actual_time_total_ms: 90, children: [] };
    parsePlan.mockReturnValue({
      node_type: "Hash Join",
      actual_time_total_ms: 100,
      children: [{ node_type: "Seq Scan on a", actual_time_total_ms: 5, children: [] }, hot],
    });

    button.click();
    await flush();

    expect(jumpButton.hidden).toBe(false);
    jumpButton.click();

    const rows = output.querySelectorAll<HTMLElement>(".tree-row");
    const hotRow = [...rows].find((r) => r.textContent?.includes("Seq Scan on b"));
    expect(document.activeElement).toBe(hotRow);
  });

  it("hides the jump-to-hottest button when the plan has no ANALYZE data", async () => {
    const { textarea, button, jumpButton } = await setup();
    textarea.value = "Seq Scan on users (cost=0.00..1.00 rows=1 width=4)";
    parsePlan.mockReturnValue({ node_type: "Seq Scan", relation: "users", children: [] });

    button.click();
    await flush();

    expect(jumpButton.hidden).toBe(true);
  });

  it("hides the jump-to-hottest button after a subsequent parse error", async () => {
    const { textarea, button, jumpButton } = await setup();
    textarea.value = "Hash Join (actual time=0.50..10.00 rows=10 loops=1)";
    parsePlan.mockReturnValue({ node_type: "Hash Join", actual_time_total_ms: 10, children: [] });
    button.click();
    await flush();
    expect(jumpButton.hidden).toBe(false);

    parsePlan.mockImplementation(() => {
      throw new Error("no plan lines found");
    });
    button.click();
    await flush();

    expect(jumpButton.hidden).toBe(true);
  });
});
