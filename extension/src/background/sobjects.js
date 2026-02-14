import { cacheGet, cacheSet, CACHE_META_TTL_MS } from "./cache.js";
import { sfRequest } from "./api.js";
import { isConfigObjectName } from "../shared/objectFilter.js";

export async function listBusinessSObjects(api, apiVersion) {
  const cacheKey = "meta:" + api.baseUrl + ":sobjects:" + apiVersion;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const res = await sfRequest(api, apiVersion, "/sobjects");
  const raw = Array.isArray(res?.sobjects) ? res.sobjects : [];

  const filtered = raw
    .filter((o) => o && o.name && !isConfigObjectName(o.name))
    .filter((o) => o.queryable) // rough "business" heuristic
    .map((o) => ({
      name: o.name,
      label: o.label || o.name,
      custom: Boolean(o.custom)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  await cacheSet(cacheKey, filtered, CACHE_META_TTL_MS);
  return filtered;
}

