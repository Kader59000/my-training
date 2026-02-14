import { log } from "./log.js";

export const PROBE_API_VERSIONS = [65, 64, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48, 47, 46, 45].map((n) => n.toFixed(1));

export function createApiClient(baseUrl, authToken, apiVersion = null) {
  return { baseUrl, authToken, apiVersion, mode: "bearer" };
}

export async function resolveApiConnectionBearer(tokenCandidates, apiBaseUrls) {
  const errors = [];
  const orderedBaseUrls = sortApiBaseUrls(apiBaseUrls);

  for (const token of tokenCandidates || []) {
    for (const baseUrl of orderedBaseUrls) {
      log("api:probeBase", { baseUrl, mode: "bearer" });
      const api = await probeApiClientBearer(baseUrl, token);
      if (api) return api;
      errors.push(baseUrl + " -> bearer rejeté");
    }
  }

  throw new Error("Aucune session API valide trouvée. Dernière erreur: " + errors[errors.length - 1]);
}

async function probeApiClientBearer(baseUrl, token) {
  const baseOrigin = new URL(baseUrl).origin;
  try {
    const probe = await probeServicesData(baseOrigin, token);
    if (!probe.ok) return null;

    const resolvedOrigin = probe.finalOrigin || baseOrigin;
    if (resolvedOrigin !== baseOrigin) {
      log("api:redirect", { from: baseOrigin, to: resolvedOrigin });
    }

    const versions = probe.versions;
    const latest = Array.isArray(versions) && versions.length ? versions[versions.length - 1] : null;
    const version = latest?.version ? String(latest.version) : null;
    if (!version) return null;

    return createApiClient(resolvedOrigin, token, version);
  } catch (_e) {
    return null;
  }

  return null;
}

async function probeServicesData(origin, token) {
  const url = origin + "/services/data/";
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    credentials: "omit",
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + token
    }
  });

  const finalOrigin = (() => {
    try {
      return new URL(response.url).origin;
    } catch (_e) {
      return null;
    }
  })();

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  if (!response.ok || isHtml) {
    const text = await response.text().catch(() => "");
    log("http:error", {
      url,
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      bodyHint: text.slice(0, 180)
    });
    return { ok: false, finalOrigin: finalOrigin || null, versions: null };
  }

  const json = await response.json().catch(() => null);
  return { ok: true, finalOrigin: finalOrigin || null, versions: json };
}

async function probeOk(origin, path, token) {
  const url = origin + path;
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    credentials: "omit",
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + token
    }
  });

  const finalOrigin = (() => {
    try {
      return new URL(response.url).origin;
    } catch (_e) {
      return null;
    }
  })();

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  if (!response.ok || isHtml) {
    const text = await response.text().catch(() => "");
    log("http:error", {
      url,
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      bodyHint: text.slice(0, 180)
    });
  }

  return { ok: response.ok && !isHtml, finalOrigin };
}

export async function getLatestApiVersion(api) {
  const versions = await fetchJson(api, "/services/data/");
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("Versions API Salesforce indisponibles.");
  }
  const latest = versions[versions.length - 1];
  const value = String(latest.version || "").trim();
  if (!value) throw new Error("Impossible de déterminer la version API.");
  return value;
}

export async function sfRequest(api, apiVersion, path) {
  if (!path.startsWith("/")) {
    throw new Error("sfRequest attend un chemin absolu Salesforce.");
  }
  const fullPath = path.startsWith("/services/data/") ? path : "/services/data/v" + apiVersion + path;
  return fetchJson(api, fullPath);
}

export async function queryAll(api, apiVersion, soql, maxRecords) {
  const records = [];
  let nextPath = "/query?q=" + encodeURIComponent(soql);

  while (nextPath && records.length < maxRecords) {
    const res = await sfRequest(api, apiVersion, nextPath);
    const batch = Array.isArray(res?.records) ? res.records : [];
    records.push(...batch);
    nextPath = res?.nextRecordsUrl || null;
  }

  if (records.length > maxRecords) {
    records.length = maxRecords;
  }

  return records;
}

async function fetchJson(api, path) {
  const url = api.baseUrl + path;

  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    credentials: "omit",
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + api.authToken
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const isHtml = contentType.includes("text/html");

  if (!response.ok || isHtml) {
    const text = await response.text();
    log("http:error", {
      url,
      finalUrl: response.url,
      status: response.status,
      statusText: response.statusText,
      contentType,
      bodyHint: text.slice(0, 180)
    });
    throw new Error("Erreur Salesforce " + response.status + ": " + text.slice(0, 200));
  }

  const json = await response.json();
  return json;
}

function sortApiBaseUrls(urls) {
  const items = Array.isArray(urls) ? urls.slice() : [];
  items.sort((a, b) => scoreApiBaseUrl(b) - scoreApiBaseUrl(a));
  return items;
}

function scoreApiBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).host.toLowerCase();
    if (host.includes(".my.salesforce.com")) return 400;
    if (host.endsWith(".salesforce.com")) return 300;
    if (host.endsWith(".lightning.force.com")) return 200;
    if (host.endsWith(".force.com")) return 100;
    return 0;
  } catch (_e) {
    return 0;
  }
}
