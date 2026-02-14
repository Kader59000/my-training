import { maskToken } from "../shared/mask.js";

const LOG_BUFFER = [];
const LOG_BUFFER_MAX = 400;

export function log(event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    data
  };
  LOG_BUFFER.push(entry);
  if (LOG_BUFFER.length > LOG_BUFFER_MAX) {
    LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_BUFFER_MAX);
  }
}

export function getLogs() {
  return LOG_BUFFER.slice();
}

export function clearLogs() {
  LOG_BUFFER.splice(0, LOG_BUFFER.length);
}

// Helper for log payloads.
export function maskMany(tokens, max = 5) {
  return (tokens || []).slice(0, max).map(maskToken);
}
