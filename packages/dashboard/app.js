const API = window.location.origin;

async function fetchJSON(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") node.className = v;
    else if (k === "textContent") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function statCard(value, label, color = "") {
  return el("div", { className: `stat-card ${color}` }, [
    el("div", { className: "value", textContent: String(value) }),
    el("div", { className: "label", textContent: label }),
  ]);
}

async function renderStats() {
  const container = document.getElementById("stats");
  try {
    const s = await fetchJSON("/api/metrics/summary");
    container.replaceChildren(
      statCard(s.totalCards, "Knowledge Cards"),
      statCard(s.totalFlows, "Flows Detected"),
      statCard(s.totalQueries, "Queries Served"),
      statCard(`${s.cacheHitRate.toFixed(0)}%`, "Cache Hit Rate", "green"),
      statCard(s.estimatedTokensSaved.toLocaleString(), "Tokens Saved", "green"),
      statCard(`$${s.estimatedCostSaved.toFixed(2)}`, "Estimated Savings", "green"),
      statCard(s.staleCards, "Stale Cards", s.staleCards > 0 ? "yellow" : ""),
    );
  } catch (e) {
    container.replaceChildren(el("p", { className: "empty", textContent: `Failed to load stats: ${e.message}` }));
  }
}

async function renderFlows() {
  const container = document.getElementById("flows");
  try {
    const flows = await fetchJSON("/api/flows");
    if (!flows.length) {
      container.replaceChildren(el("p", { className: "empty", textContent: "No flows indexed yet. Run: pnpm index" }));
      return;
    }
    container.replaceChildren(
      ...flows.map((f) =>
        el("div", { className: "flow-tag" }, [
          el("span", { className: "name", textContent: f.flow }),
          el("span", { className: "count", textContent: `${f.cardCount} cards` }),
        ])
      )
    );
  } catch (e) {
    container.replaceChildren(el("p", { className: "empty", textContent: `Failed to load flows` }));
  }
}

async function renderTopQueries() {
  const container = document.getElementById("top-queries");
  try {
    const s = await fetchJSON("/api/metrics/summary");
    const queries = s.topQueries || [];
    if (!queries.length) {
      container.replaceChildren(el("p", { className: "empty", textContent: "No queries yet" }));
      return;
    }
    container.replaceChildren(
      ...queries.map((q) =>
        el("div", { className: "query-item" }, [
          el("span", { className: "text", textContent: q.query }),
          el("span", { className: "badge", textContent: `${q.count}x` }),
        ])
      )
    );
  } catch {
    container.replaceChildren(el("p", { className: "empty", textContent: "No queries yet" }));
  }
}

async function renderTopCards() {
  const container = document.getElementById("top-cards");
  try {
    const s = await fetchJSON("/api/metrics/summary");
    const cards = s.topCards || [];
    if (!cards.length) {
      container.replaceChildren(el("p", { className: "empty", textContent: "No card usage yet" }));
      return;
    }
    container.replaceChildren(
      ...cards.map((c) =>
        el("div", { className: "card-item" }, [
          el("span", { className: "text", textContent: `${c.flow} / ${c.title}` }),
          el("span", { className: "badge", textContent: `${c.usageCount} uses` }),
        ])
      )
    );
  } catch {
    container.replaceChildren(el("p", { className: "empty", textContent: "No card usage yet" }));
  }
}

renderStats();
renderFlows();
renderTopQueries();
renderTopCards();
