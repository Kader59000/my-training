export function normalizeRecordId(value) {
  if (!value) return null;
  return String(value).substring(0, 18);
}

export function findRecordIdFromUrl(url) {
  const s = String(url || "");
  const lightningMatch = s.match(/\/lightning\/r\/[^/]+\/(\w{15,18})\//i);
  if (lightningMatch) return normalizeRecordId(lightningMatch[1]);

  const classicMatch = s.match(/[?&]id=(\w{15,18})/i);
  if (classicMatch) return normalizeRecordId(classicMatch[1]);

  const genericMatch = s.match(/\b([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})\b/);
  return genericMatch ? normalizeRecordId(genericMatch[1]) : null;
}

export function findObjectFromLightningUrl(url) {
  const m = String(url || "").match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})\//);
  if (!m) return null;
  return m[1] || null;
}
