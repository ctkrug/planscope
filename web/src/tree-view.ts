import { findHottestNode, isRowEstimateMismatch, type PlanNode } from "./plan";

/** Renders a PlanNode tree into a fresh, self-contained DOM subtree. */
export function renderTree(root: PlanNode): HTMLElement {
  const hottest = findHottestNode(root);
  const container = document.createElement("div");
  container.className = "tree";
  container.setAttribute("role", "tree");
  container.appendChild(renderNode(root, hottest));
  return container;
}

function renderNode(node: PlanNode, hottest: PlanNode | undefined): HTMLElement {
  const item = document.createElement("div");
  item.className = "tree-node";
  item.setAttribute("role", "treeitem");

  const row = document.createElement("div");
  row.className = "tree-row";
  if (node === hottest) {
    row.classList.add("tree-row-hottest");
  }

  const hasChildren = node.children.length > 0;
  let toggle: HTMLButtonElement | undefined;
  let childrenEl: HTMLElement | undefined;

  if (hasChildren) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Collapse node");
    toggle.textContent = "▾";
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "tree-toggle-spacer";
    spacer.setAttribute("aria-hidden", "true");
    row.appendChild(spacer);
  }

  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = node.relation ? `${node.node_type} on ${node.relation}` : node.node_type;
  row.appendChild(label);

  const meta = document.createElement("span");
  meta.className = "tree-meta";
  meta.textContent = describeMeta(node);
  row.appendChild(meta);

  if (node === hottest) {
    const flag = document.createElement("span");
    flag.className = "tree-badge tree-badge-hot";
    flag.textContent = "hottest";
    row.appendChild(flag);
  }

  if (isRowEstimateMismatch(node)) {
    const badge = document.createElement("span");
    badge.className = "tree-badge tree-badge-mismatch";
    badge.textContent = `est ${node.estimated_rows!.toLocaleString()} → actual ${node.actual_rows!.toLocaleString()}`;
    row.appendChild(badge);
  }

  item.appendChild(row);

  if (hasChildren) {
    childrenEl = document.createElement("div");
    childrenEl.className = "tree-children";
    childrenEl.setAttribute("role", "group");
    for (const child of node.children) {
      childrenEl.appendChild(renderNode(child, hottest));
    }
    item.appendChild(childrenEl);

    toggle!.addEventListener("click", () => {
      const expanded = toggle!.getAttribute("aria-expanded") === "true";
      toggle!.setAttribute("aria-expanded", String(!expanded));
      toggle!.setAttribute("aria-label", expanded ? "Expand node" : "Collapse node");
      toggle!.textContent = expanded ? "▸" : "▾";
      if (expanded) {
        childrenEl!.remove();
      } else {
        item.appendChild(childrenEl!);
      }
    });
  }

  return item;
}

function describeMeta(node: PlanNode): string {
  const parts: string[] = [];
  if (node.estimated_rows !== undefined) {
    parts.push(`est ${node.estimated_rows.toLocaleString()} rows`);
  }
  if (node.actual_rows !== undefined) {
    parts.push(`actual ${node.actual_rows.toLocaleString()} rows`);
  }
  if (node.actual_time_total_ms !== undefined) {
    parts.push(`${node.actual_time_total_ms.toFixed(2)} ms`);
  }
  return parts.join(" · ");
}
