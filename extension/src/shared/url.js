export function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (_e) {
    return null;
  }
}
