import { safeHost } from "../shared/url.js";
import { findObjectFromLightningUrl, findRecordIdFromUrl, normalizeRecordId } from "../shared/sfIds.js";
import { maskToken } from "../shared/mask.js";
import { getSessionCandidates } from "./auth.js";
import { queryAll, sfRequest } from "./api.js";
import { log } from "./log.js";
import { isConfigObjectName } from "../shared/objectFilter.js";
import { resolveContextForTab } from "./context.js";

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_CHILDREN_LIMIT = 0; // 0 => unlimited (with safety caps)

const MAX_RECORDS_PER_RELATIONSHIP = 5000;
const MAX_NODES_TOTAL = 20000;

export async function getSessionDetails(tabUrl) {
  const { host, sidCandidates } = await getSessionCandidates(tabUrl);
  const sid = sidCandidates[0] || null;
  log("session:cookie", { host, hasSid: Boolean(sid), sidHint: sid ? maskToken(sid) : null });
  return {
    hasSessionCookie: Boolean(sid),
    tokenHint: sid ? maskToken(sid) : null,
    host
  };
}

export async function analyzeSalesforceTab({ tabId, tabUrl, maxDepth, childrenLimit, trackedObjects }) {
  log("analyze:start", { tabId, tabUrlHost: safeHost(tabUrl) });

  if (!tabUrl) throw new Error("URL onglet vide.");
  const recordId = findRecordIdFromUrl(tabUrl);
  if (!recordId) throw new Error("Record Salesforce non detecte dans l'URL.");

  log("record:detected", {
    recordIdPrefix: recordId.slice(0, 3),
    recordIdHint: recordId.slice(0, 6) + "..." + recordId.slice(-4)
  });

  const rootObject = findObjectFromLightningUrl(tabUrl);
  if (!rootObject) throw new Error("Objet non reconnu depuis l'URL.");
  if (isConfigObjectName(rootObject)) throw new Error("Objet de configuration non supporte: " + rootObject);

  const tracked = normalizeTrackedObjects(trackedObjects, rootObject);
  const ctx = await resolveContextForTab(tabUrl);

  const state = {
    api: ctx.api,
    apiVersion: ctx.apiVersion,
    tabOrigin: ctx.tabOrigin,
    maxDepth: Number.isInteger(maxDepth) ? maxDepth : DEFAULT_MAX_DEPTH,
    childrenLimit: Number.isInteger(childrenLimit) ? childrenLimit : DEFAULT_CHILDREN_LIMIT,
    trackedObjects: tracked, // Set<string>
    describeCache: new Map(), // objectName -> describe
    nodes: new Map(),
    edges: [],
    visited: new Set()
  };

  const root = await walkGraph(rootObject, recordId, state);
  return {
    host: new URL(tabUrl).host,
    apiVersion: state.apiVersion,
    rootObject,
    trackedObjects: Array.from(tracked),
    root,
    nodes: Array.from(state.nodes.values()),
    edges: state.edges
  };
}

function normalizeTrackedObjects(input, rootObject) {
  const arr = Array.isArray(input) ? input : [];
  const out = new Set();
  for (const name of arr) {
    const s = String(name || "").trim();
    if (!s) continue;
    if (isConfigObjectName(s)) continue;
    out.add(s);
  }
  out.add(rootObject); // root object must always be included
  return out;
}

async function walkGraph(rootObject, rootId, state) {
  const queue = [{ objectName: rootObject, recordId: rootId, depth: 0, parentKey: null, relationLabel: null }];
  let rootKey = null;

  while (queue.length > 0) {
    if (state.nodes.size >= MAX_NODES_TOTAL) {
      log("graph:nodeCap", { cap: MAX_NODES_TOTAL });
      break;
    }

    const item = queue.shift();
    const objectName = String(item.objectName);
    if (!state.trackedObjects.has(objectName)) continue;

    const recordId = normalizeRecordId(item.recordId);
    if (!recordId) continue;

    const key = objectName + ":" + recordId;
    if (state.visited.has(key)) continue;
    state.visited.add(key);

    const describe = await getDescribe(state, objectName);
    const displayField = pickDisplayField(describe, objectName);

    // Only reference fields that can possibly lead to tracked objects.
    const referenceFields = (describe?.fields || []).filter((f) =>
      f &&
      f.type === "reference" &&
      !f.deprecatedAndHidden &&
      Array.isArray(f.referenceTo) &&
      f.referenceTo.some((t) => state.trackedObjects.has(t))
    );

    const record = await querySingleRecord(state, objectName, recordId, [
      "Id",
      displayField,
      ...referenceFields.map((f) => f.name)
    ]);
    if (!record) continue;

    const node = upsertNode(state, objectName, recordId, record, displayField, item.depth, item.parentKey, item.relationLabel);
    if (!rootKey) rootKey = node.key;

    if (item.depth >= state.maxDepth) continue;

    // Parents
    for (const ref of referenceFields) {
      const linkedId = normalizeRecordId(record?.[ref.name]);
      if (!linkedId) continue;

      const targetObject = pickTargetObjectForRef(ref, state.trackedObjects);
      if (!targetObject) continue;

      const targetKey = targetObject + ":" + linkedId;
      state.edges.push({ from: node.key, to: targetKey, relation: ref.label || ref.name, direction: "parent" });
      queue.push({
        objectName: targetObject,
        recordId: linkedId,
        depth: item.depth + 1,
        parentKey: node.key,
        relationLabel: ref.label || ref.name
      });
    }

    // Children
    const childRels = Array.isArray(describe?.childRelationships) ? describe.childRelationships : [];
    for (const rel of childRels) {
      if (!rel || !rel.childSObject || !rel.field || rel.deprecatedAndHidden) continue;
      const childObject = rel.childSObject;
      if (!state.trackedObjects.has(childObject)) continue;

      const childDescribe = await getDescribe(state, childObject);
      const childDisplay = pickDisplayField(childDescribe, childObject);

      const fields = uniqueStrings(["Id", childDisplay]);
      const soql = [
        "SELECT " + fields.join(", "),
        "FROM " + childObject,
        "WHERE " + rel.field + " = '" + recordId + "'"
      ].join(" ");

      const maxPerRel =
        state.childrenLimit && state.childrenLimit > 0
          ? state.childrenLimit
          : MAX_RECORDS_PER_RELATIONSHIP;

      let children = [];
      try {
        children = await queryAll(state.api, state.apiVersion, soql, maxPerRel);
      } catch (_e) {
        continue;
      }

      for (const child of children) {
        const childId = normalizeRecordId(child?.Id);
        if (!childId) continue;

        const childKey = childObject + ":" + childId;
        state.edges.push({
          from: node.key,
          to: childKey,
          relation: rel.relationshipName || rel.field,
          direction: "child"
        });
        queue.push({
          objectName: childObject,
          recordId: childId,
          depth: item.depth + 1,
          parentKey: node.key,
          relationLabel: rel.relationshipName || rel.field
        });
      }
    }
  }

  const rootNode = rootKey ? state.nodes.get(rootKey) : null;
  if (!rootNode) throw new Error("Aucun record analysable trouve.");
  return rootNode;
}

async function getDescribe(state, objectName) {
  if (state.describeCache.has(objectName)) return state.describeCache.get(objectName);
  const describe = await sfRequest(state.api, state.apiVersion, "/sobjects/" + encodeURIComponent(objectName) + "/describe");
  state.describeCache.set(objectName, describe);
  return describe;
}

function pickDisplayField(describe, objectName) {
  // Best-effort: CaseNumber for Case, else a "nameField" if present, else Name, else Id.
  if (objectName === "Case") return "CaseNumber";

  const fields = Array.isArray(describe?.fields) ? describe.fields : [];
  const nameField = fields.find((f) => f && f.name && f.nameField);
  if (nameField?.name) return nameField.name;

  const name = fields.find((f) => f && f.name === "Name");
  if (name) return "Name";

  return "Id";
}

async function querySingleRecord(state, objectName, recordId, fields) {
  const safeFields = uniqueStrings(fields).filter(Boolean);
  const soql = "SELECT " + safeFields.join(", ") + " FROM " + objectName + " WHERE Id = '" + recordId + "' LIMIT 1";
  const data = await sfRequest(state.api, state.apiVersion, "/query?q=" + encodeURIComponent(soql));
  return data?.records?.[0] || null;
}

function upsertNode(state, objectName, recordId, record, displayField, depth, parentKey, relationLabel) {
  const key = objectName + ":" + recordId;
  const existing = state.nodes.get(key);
  if (existing) return existing;

  const label = displayField && displayField !== "Id"
    ? (record?.[displayField] || recordId)
    : recordId;

  const node = {
    key,
    recordId,
    objectName,
    label,
    depth,
    parentKey,
    relationLabel,
    url: buildRecordUrl(state.tabOrigin, objectName, recordId)
  };
  state.nodes.set(key, node);
  return node;
}

function buildRecordUrl(origin, objectName, recordId) {
  return origin + "/lightning/r/" + encodeURIComponent(objectName) + "/" + recordId + "/view";
}

function pickTargetObjectForRef(refField, trackedObjects) {
  if (!refField || !Array.isArray(refField.referenceTo)) return null;
  // Prefer the single target if obvious, else first tracked.
  if (refField.referenceTo.length === 1) {
    const single = refField.referenceTo[0];
    return trackedObjects.has(single) ? single : null;
  }
  return refField.referenceTo.find((t) => trackedObjects.has(t)) || null;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

