import { createGraphView } from "./graphCanvas.js";
import { createLogsController } from "./logs.js";

const statusEl = document.getElementById("status");
const sessionInfoEl = document.getElementById("sessionInfo");
const canvasEl = document.getElementById("graphCanvas");
const refreshBtn = document.getElementById("refreshBtn");
const logsBoxEl = document.getElementById("logsBox");
const copyLogsBtn = document.getElementById("copyLogsBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const trackedPillsEl = document.getElementById("trackedPills");
const addObjectBtn = document.getElementById("addObjectBtn");
const objectSearchEl = document.getElementById("objectSearch");
const objectSearchInputEl = document.getElementById("objectSearchInput");
const objectSearchResultsEl = document.getElementById("objectSearchResults");

const graphView = createGraphView(canvasEl);
const logs = createLogsController({ logsBoxEl, sendMessage: sendMessageToBackground });

refreshBtn.addEventListener("click", () => loadGraph(true));
copyLogsBtn.addEventListener("click", () => logs.copy());
clearLogsBtn.addEventListener("click", () => logs.clear());

addObjectBtn.addEventListener("click", () => {
  objectSearchEl.classList.toggle("hidden");
  objectSearchResultsEl.classList.add("hidden");
  objectSearchInputEl.value = "";
  if (!objectSearchEl.classList.contains("hidden")) {
    setTimeout(() => objectSearchInputEl.focus(), 0);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadGraph(false);
});

const state = {
  rootObject: null,
  trackedObjects: new Set(),
  tabUrl: null
};

let searchTimer = null;
objectSearchInputEl.addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runObjectSearch(), 1000);
});

async function loadGraph(manual) {
  setStatus(manual ? "Analyse en cours…" : "Chargement…");
  sessionInfoEl.textContent = "";
  logsBoxEl.textContent = "";
  graphView.clear();
  await logs.refresh();

  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) throw new Error("Impossible de recuperer l'onglet actif.");
    state.tabUrl = tab.url;

    if (!/\.(salesforce|force)\.com\//i.test(tab.url)) {
      setStatus("Cette extension fonctionne uniquement sur Salesforce.");
      return;
    }

    // If we don't know root object yet, start with a default tracked set.
    if (state.trackedObjects.size === 0) {
      // Default: useful core objects; root will be enforced by backend anyway.
      state.trackedObjects = new Set(["Account", "Contact", "Case"]);
    }

    const [sessionResponse, graphResponse] = await Promise.all([
      sendMessageToBackground({ type: "SFX_GET_SESSION", tabUrl: tab.url }),
      // childrenLimit: 0 => unlimited (with internal safety caps)
      sendMessageToBackground({
        type: "SFX_ANALYZE_TAB",
        tabId: tab.id,
        tabUrl: tab.url,
        maxDepth: 5,
        childrenLimit: 0,
        trackedObjects: Array.from(state.trackedObjects)
      })
    ]);

    if (!sessionResponse?.ok) throw new Error(sessionResponse?.error || "Session Salesforce indisponible.");

    sessionInfoEl.textContent = sessionResponse.session.hasSessionCookie
      ? "Session detectee (token: " + (sessionResponse.session.tokenHint || "masque") + ")"
      : "Session cookie non lisible, analyse indisponible.";

    if (!graphResponse?.ok) throw new Error(graphResponse?.error || "Analyse Salesforce impossible.");

    state.rootObject = graphResponse.result.rootObject || state.rootObject;
    // Backend enforces root object, keep UI in sync.
    state.trackedObjects = new Set(graphResponse.result.trackedObjects || Array.from(state.trackedObjects));
    renderTrackedPills();

    graphView.setGraph(graphResponse.result);
    setStatus("Analyse terminee.");
    await logs.refresh();
  } catch (error) {
    setStatus("Erreur: " + error.message);
    await logs.refresh();
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendMessageToBackground(payload) {
  return chrome.runtime.sendMessage(payload);
}

function renderTrackedPills() {
  trackedPillsEl.textContent = "";

  const items = Array.from(state.trackedObjects).sort((a, b) => a.localeCompare(b));
  for (const obj of items) {
    const pill = document.createElement("span");
    pill.className = "pill " + pillClassFor(obj);
    pill.textContent = obj;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "pill-x";
    x.textContent = "x";

    const isRoot = state.rootObject && obj === state.rootObject;
    if (isRoot) {
      x.disabled = true;
      x.title = "Impossible de supprimer l'objet racine.";
    } else {
      x.title = "Retirer " + obj;
      x.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        state.trackedObjects.delete(obj);
        renderTrackedPills();
        await loadGraph(true);
      });
    }

    pill.appendChild(x);
    trackedPillsEl.appendChild(pill);
  }
}

function pillClassFor(objectName) {
  if (objectName === "Account") return "account";
  if (objectName === "Contact") return "contact";
  if (objectName === "Case") return "case";
  return "other";
}

async function runObjectSearch() {
  const q = String(objectSearchInputEl.value || "").trim();
  if (!q) {
    objectSearchResultsEl.textContent = "";
    objectSearchResultsEl.classList.add("hidden");
    return;
  }
  if (!state.tabUrl) return;

  const res = await sendMessageToBackground({ type: "SFX_SEARCH_OBJECTS", tabUrl: state.tabUrl, query: q });
  if (!res?.ok) {
    objectSearchResultsEl.textContent = "";
    objectSearchResultsEl.classList.add("hidden");
    return;
  }

  const items = Array.isArray(res.items) ? res.items : [];
  if (items.length === 0) {
    objectSearchResultsEl.textContent = "";
    objectSearchResultsEl.classList.add("hidden");
    return;
  }

  objectSearchResultsEl.textContent = "";
  objectSearchResultsEl.classList.remove("hidden");

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "object-item";
    row.addEventListener("click", async () => {
      state.trackedObjects.add(item.name);
      renderTrackedPills();
      objectSearchEl.classList.add("hidden");
      objectSearchInputEl.value = "";
      objectSearchResultsEl.textContent = "";
      objectSearchResultsEl.classList.add("hidden");
      await loadGraph(true);
    });

    const left = document.createElement("div");
    left.textContent = item.label || item.name;

    const right = document.createElement("div");
    right.className = "meta";
    right.textContent = item.name;

    row.appendChild(left);
    row.appendChild(right);
    objectSearchResultsEl.appendChild(row);
  }
}
