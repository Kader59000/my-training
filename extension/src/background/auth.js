import { unique } from "../shared/sets.js";
import { maskToken } from "../shared/mask.js";
import { log } from "./log.js";

export const SALESFORCE_URL_REGEX = /^https?:\/\/[^/]+\.(salesforce|force)\.com\//i;

export function isLikelySfToken(value) {
  if (!value || typeof value !== "string") return false;
  return /^00D[a-zA-Z0-9]{12,15}!/.test(value) || /^00D[a-zA-Z0-9]{12,15}/.test(value);
}

export async function getSessionCandidates(tabUrl) {
  if (!tabUrl || !SALESFORCE_URL_REGEX.test(tabUrl)) {
    throw new Error("URL onglet Salesforce invalide.");
  }

  const url = new URL(tabUrl);

  // Strategy borrowed from Salesforce Inspector Reloaded:
  // Try to find the API-enabled sid cookie by matching orgId + '!'.
  const directSid = await chrome.cookies.get({ url: tabUrl, name: "sid" });
  const orgId = typeof directSid?.value === "string" ? directSid.value.split("!")[0] : null;

  let matched = null;
  if (orgId && /^00D/.test(orgId) && !url.hostname.endsWith(".mcas.ms")) {
    const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com"];
    for (const domain of orderedDomains) {
      const cookies = await chrome.cookies.getAll({ name: "sid", domain, secure: true });
      const sessionCookie = cookies.find((c) =>
        typeof c?.value === "string" &&
        c.value.startsWith(orgId + "!") &&
        c.domain !== "help.salesforce.com"
      );
      if (sessionCookie) {
        matched = sessionCookie;
        break;
      }
    }
  }

  const allSid = await chrome.cookies.getAll({ name: "sid" });
  const ranked = rankCookiesForHost(url.hostname, allSid);

  const bestCookie = matched || ranked[0] || directSid || null;
  const bestHost = bestCookie?.domain ? String(bestCookie.domain).replace(/^\./, "") : url.host;

  const sidCandidates = unique([bestCookie?.value, directSid?.value].filter(Boolean));

  const apiBaseUrls = unique([
    ...deriveApiBaseUrls(bestHost),
    ...deriveApiBaseUrls(url.host)
  ]).filter((u) => !/\.file\.force\.com$/i.test(new URL(u).host));

  log("session:resolvedCookie", {
    orgId: orgId || null,
    matched: Boolean(matched),
    bestHost,
    sidHint: bestCookie?.value ? maskToken(bestCookie.value) : null
  });

  return { host: url.host, sidCandidates, apiBaseUrls };
}

function deriveApiBaseUrls(host) {
  const urls = ["https://" + host];
  if (host.endsWith(".lightning.force.com")) {
    urls.push("https://" + host.replace(".lightning.force.com", ".my.salesforce.com"));
    urls.push("https://" + host.replace(".lightning.force.com", ".salesforce.com"));
  }
  if (host.endsWith(".my.salesforce.com")) {
    urls.push("https://" + host.replace(".my.salesforce.com", ".lightning.force.com"));
  }
  return urls;
}

function rankCookiesForHost(hostname, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return [];
  return cookies
    .map((cookie) => ({ cookie, score: cookieMatchScore(hostname, cookie.domain || "") }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.cookie);
}

function cookieMatchScore(hostname, domain) {
  const clean = String(domain || "").replace(/^\./, "").toLowerCase();
  const host = hostname.toLowerCase();
  if (!clean) return 0;
  if (host === clean) return clean.length + 100;
  if (host.endsWith("." + clean)) return clean.length;
  return 1;
}
