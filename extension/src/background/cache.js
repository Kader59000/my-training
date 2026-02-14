const CACHE_MEM = new Map(); // key -> { expiresAt, value }

export const CACHE_META_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_DATA_TTL_MS = 3 * 60 * 1000;

export async function cacheGet(key) {
  const now = Date.now();
  const mem = CACHE_MEM.get(key);
  if (mem && mem.expiresAt > now) return mem.value;
  CACHE_MEM.delete(key);

  try {
    if (chrome.storage?.session) {
      const res = await chrome.storage.session.get(key);
      const entry = res?.[key];
      if (entry && entry.expiresAt > now) {
        CACHE_MEM.set(key, entry);
        return entry.value;
      }
      if (entry) {
        await chrome.storage.session.remove(key);
      }
    }
  } catch (_e) {
    // ignore
  }

  return null;
}

export async function cacheSet(key, value, ttlMs) {
  const entry = { expiresAt: Date.now() + ttlMs, value };
  CACHE_MEM.set(key, entry);
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: entry });
    }
  } catch (_e) {
    // ignore
  }
}
