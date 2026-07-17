import "./style.css";
import { engineLabel, isEngine, type Engine } from "./engine";

const ENGINES: Engine[] = ["postgres", "mysql", "sqlite"];

function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="site-header">
      <span class="wordmark">Plan<em>scope</em></span>
      <p class="tagline">Paste an EXPLAIN plan. See the tree, and the node that's slow.</p>
    </header>
    <main class="workspace">
      <section class="input-panel" aria-label="Plan input">
        <label for="engine-select">Engine</label>
        <select id="engine-select">
          ${ENGINES.map((e) => `<option value="${e}">${engineLabel(e)}</option>`).join("")}
        </select>
        <label for="plan-input">EXPLAIN output</label>
        <textarea
          id="plan-input"
          placeholder="Paste EXPLAIN (ANALYZE) output here..."
          spellcheck="false"
        ></textarea>
        <button id="visualize-btn" type="button">Visualize</button>
      </section>
      <section class="output-panel" aria-label="Cost tree" aria-live="polite">
        <p class="output-placeholder" id="output-placeholder">
          The cost tree will render here once you paste a plan.
        </p>
      </section>
    </main>
  `;

  const button = root.querySelector<HTMLButtonElement>("#visualize-btn")!;
  const select = root.querySelector<HTMLSelectElement>("#engine-select")!;
  const input = root.querySelector<HTMLTextAreaElement>("#plan-input")!;
  const output = root.querySelector<HTMLElement>("#output-placeholder")!;

  button.addEventListener("click", () => {
    const engine = select.value;
    if (!isEngine(engine)) return;
    if (!input.value.trim()) {
      output.textContent = "Paste a plan first.";
      return;
    }
    output.textContent = `Parsing as ${engineLabel(engine)}... (parser wiring lands in the build phase)`;
  });
}

const root = document.getElementById("app");
if (root) {
  renderApp(root);
}
