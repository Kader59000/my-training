export function createLogsController({ logsBoxEl, sendMessage }) {
  async function refresh() {
    try {
      const res = await sendMessage({ type: "SFX_GET_LOGS" });
      if (!res?.ok) return;
      const lines = (res.logs || []).map(formatLogLine);
      logsBoxEl.textContent = lines.join("\n");
    } catch (_e) {
      // ignore
    }
  }

  async function clear() {
    await sendMessage({ type: "SFX_CLEAR_LOGS" });
    await refresh();
  }

  async function copy() {
    const text = logsBoxEl.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_e) {
      // clipboard can be blocked; ignore
    }
  }

  return { refresh, clear, copy };
}

function formatLogLine(entry) {
  const ts = entry?.ts || "";
  const ev = entry?.event || "";
  let data = "";
  try {
    data = entry?.data ? JSON.stringify(entry.data) : "";
  } catch (_e) {
    data = String(entry?.data || "");
  }
  return ts + " " + ev + (data ? " " + data : "");
}

