import { installActionStateHandlers } from "./actionState.js";
import { analyzeSalesforceTab, getSessionDetails } from "./analyze.js";
import { clearLogs, getLogs, log } from "./log.js";
import { resolveContextForTab } from "./context.js";
import { listBusinessSObjects } from "./sobjects.js";

installActionStateHandlers();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SFX_GET_SESSION") {
    getSessionDetails(message.tabUrl)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SFX_ANALYZE_TAB") {
    analyzeSalesforceTab({
      tabId: message.tabId,
      tabUrl: message.tabUrl,
      maxDepth: message.maxDepth,
      childrenLimit: message.childrenLimit,
      trackedObjects: message.trackedObjects
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        log("analyze:error", { message: error.message });
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "SFX_SEARCH_OBJECTS") {
    (async () => {
      const q = String(message.query || "").trim().toLowerCase();
      if (!q) return [];
      const ctx = await resolveContextForTab(message.tabUrl);
      const all = await listBusinessSObjects(ctx.api, ctx.apiVersion);
      // Simple contains match over name/label.
      return all
        .filter((o) =>
          o.name.toLowerCase().includes(q) ||
          String(o.label || "").toLowerCase().includes(q)
        )
        .slice(0, 25);
    })()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SFX_GET_LOGS") {
    sendResponse({ ok: true, logs: getLogs() });
    return false;
  }

  if (message?.type === "SFX_CLEAR_LOGS") {
    clearLogs();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
