import { getSessionCandidates } from "./auth.js";
import { resolveApiConnectionBearer } from "./api.js";
import { maskToken } from "../shared/mask.js";
import { log } from "./log.js";

export async function resolveContextForTab(tabUrl) {
  const { sidCandidates, apiBaseUrls } = await getSessionCandidates(tabUrl);
  const tokenCandidates = sidCandidates.filter(Boolean);

  log("session:candidates", {
    sidCount: sidCandidates.length,
    baseUrls: apiBaseUrls,
    sidHints: sidCandidates.slice(0, 5).map(maskToken)
  });

  const api = await resolveApiConnectionBearer(tokenCandidates, apiBaseUrls);
  log("api:resolved", {
    baseUrl: api.baseUrl,
    apiVersion: api.apiVersion || null,
    tokenHint: api.authToken ? maskToken(api.authToken) : null
  });

  return {
    api,
    apiVersion: api.apiVersion,
    tabOrigin: new URL(tabUrl).origin
  };
}

