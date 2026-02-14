import { SALESFORCE_URL_REGEX } from "./auth.js";

function syncActionState(tabId, url) {
  if (!tabId || tabId < 0) return;
  if (url && SALESFORCE_URL_REGEX.test(url)) chrome.action.enable(tabId);
  else chrome.action.disable(tabId);
}

export function installActionStateHandlers() {
  chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) syncActionState(tab.id, tab.url);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const nextUrl = changeInfo.url || tab.url;
    syncActionState(tabId, nextUrl);
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    syncActionState(tab.id, tab.url);
  });
}

