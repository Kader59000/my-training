const SALESFORCE_PATTERNS = [
  /\.salesforce\.com$/i,
  /\.force\.com$/i
];

const EXCLUDED_OBJECT_PREFIXES = [
  "Apex", "Auth", "ConnectedApplication", "ContentAsset", "Dashboard", "DataDetect", "Document", "Duplicate", "Email", "Entity", "External", "Flow", "Folder", "Installed", "Knowledge", "Login", "Matching", "Metadata", "Network", "Oauth", "Permission", "Platform", "Process", "Profile", "Queue", "RecordType", "Setup", "Site", "StaticResource", "UserPreference", "UserRole", "Vote"
];

const EXCLUDED_OBJECT_SUFFIXES = [
  "History", "Share", "Feed", "Tag", "OwnerSharingRule", "ChangeEvent", "DataType"
];

const EXCLUDED_OBJECT_EXACT = new Set([
  "User", "Group", "CollaborationGroup", "AsyncApexJob", "CronTrigger", "EntitySubscription"
]);

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_CHILDREN_LIMIT = 20;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SFX_ANALYZE") {
    analyzeCurrentPage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function analyzeCurrentPage(message) {
  if (!isSalesforceHost(window.location.hostname)) {
    throw new Error("Cette page n'est pas une page Salesforce.");
  }

  const maxDepth = Number.isInteger(message?.maxDepth) ? message.maxDepth : DEFAULT_MAX_DEPTH;
  const childrenLimit = Number.isInteger(message?.childrenLimit) ? message.childrenLimit : DEFAULT_CHILDREN_LIMIT;

  const apiVersion = await getLatestApiVersion();
  const globalDescribe = await sfRequest(apiVersion, "/services/data/v" + apiVersion + "/sobjects");
  const sobjects = globalDescribe?.sobjects || [];
  const prefixMap = buildPrefixMap(sobjects);
  const objectByName = new Map(sobjects.map((obj) => [obj.name, obj]));

  const currentRecordId = findRecordIdFromLocation(window.location.href);
  if (!currentRecordId) {
    throw new Error("Record Salesforce non détecté dans l'URL.");
  }

  const rootObject = findObjectByRecordId(currentRecordId, prefixMap);
  if (!rootObject) {
    throw new Error("Impossible de déduire l'objet Salesforce depuis l'ID courant.");
  }

  const state = {
    apiVersion,
    objectByName,
    prefixMap,
    describeCache: new Map(),
    nameFieldCache: new Map(),
    visited: new Set(),
    childrenLimit,
    maxDepth,
    nodes: new Map(),
    edges: []
  };

  const rootNode = await buildNode(rootObject, currentRecordId, 0, state);

  return {
    host: window.location.host,
    apiVersion,
    root: rootNode,
    nodes: Array.from(state.nodes.values()),
    edges: state.edges
  };
}

function isSalesforceHost(hostname) {
  return SALESFORCE_PATTERNS.some((pattern) => pattern.test(hostname));
}

function findRecordIdFromLocation(url) {
  const lightningMatch = url.match(/\/lightning\/r\/[^/]+\/(\w{15,18})\//i);
  if (lightningMatch) return normalizeRecordId(lightningMatch[1]);

  const classicMatch = url.match(/[?&]id=(\w{15,18})/i);
  if (classicMatch) return normalizeRecordId(classicMatch[1]);

  const genericMatch = url.match(/\b([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})\b/);
  return genericMatch ? normalizeRecordId(genericMatch[1]) : null;
}

function normalizeRecordId(value) {
  if (!value) return null;
  return value.substring(0, 18);
}

async function getLatestApiVersion() {
  const versions = await fetchJson("/services/data/");
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("Versions API Salesforce indisponibles.");
  }

  const latest = versions[versions.length - 1];
  const value = String(latest.version || "").trim();
  if (!value) throw new Error("Impossible de déterminer la version API.");
  return value;
}

async function sfRequest(apiVersion, path) {
  if (!path.startsWith("/")) {
    throw new Error("sfRequest attend un chemin absolu Salesforce.");
  }

  if (!path.startsWith("/services/data/")) {
    path = "/services/data/v" + apiVersion + path;
  }

  return fetchJson(path);
}

async function fetchJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("Erreur Salesforce " + response.status + ": " + text.slice(0, 200));
  }

  return response.json();
}

function buildPrefixMap(sobjects) {
  const map = new Map();
  for (const obj of sobjects) {
    if (obj?.keyPrefix) {
      map.set(obj.keyPrefix, obj.name);
    }
  }
  return map;
}

function findObjectByRecordId(recordId, prefixMap) {
  const prefix = recordId.substring(0, 3);
  return prefixMap.get(prefix) || null;
}

function shouldKeepBusinessObject(sobject) {
  if (!sobject) return false;
  if (!sobject.queryable || !sobject.retrieveable) return false;
  if (sobject.deprecatedAndHidden) return false;
  if (sobject.customSetting) return false;

  const name = sobject.name || "";
  if (!name) return false;
  if (EXCLUDED_OBJECT_EXACT.has(name)) return false;

  for (const prefix of EXCLUDED_OBJECT_PREFIXES) {
    if (name.startsWith(prefix)) return false;
  }

  for (const suffix of EXCLUDED_OBJECT_SUFFIXES) {
    if (name.endsWith(suffix)) return false;
  }

  return true;
}

async function getDescribe(state, objectName) {
  if (state.describeCache.has(objectName)) {
    return state.describeCache.get(objectName);
  }

  const describe = await sfRequest(state.apiVersion, "/sobjects/" + encodeURIComponent(objectName) + "/describe");
  state.describeCache.set(objectName, describe);
  return describe;
}

async function getNameField(state, objectName) {
  if (state.nameFieldCache.has(objectName)) {
    return state.nameFieldCache.get(objectName);
  }

  const describe = await getDescribe(state, objectName);
  const fields = describe?.fields || [];
  const explicit = fields.find((field) => field.nameField === true);
  if (explicit?.name) {
    state.nameFieldCache.set(objectName, explicit.name);
    return explicit.name;
  }

  const fallback = fields.find((field) => field.type === "string")?.name || "Id";
  state.nameFieldCache.set(objectName, fallback);
  return fallback;
}

async function querySingleRecord(state, objectName, recordId, fields) {
  const safeFields = Array.from(new Set(fields.filter(Boolean)));
  const soql = "SELECT " + safeFields.join(",") + " FROM " + objectName + " WHERE Id = '" + recordId + "' LIMIT 1";
  const data = await sfRequest(state.apiVersion, "/query?q=" + encodeURIComponent(soql));
  return data?.records?.[0] || null;
}

function buildRecordUrl(recordId) {
  return window.location.origin + "/lightning/r/" + recordId + "/view";
}

async function buildNode(objectName, recordId, depth, state, relationLabel = null, parentKey = null) {
  const key = objectName + ":" + recordId;
  if (state.visited.has(key)) {
    return state.nodes.get(key);
  }

  state.visited.add(key);

  const nameField = await getNameField(state, objectName);
  const describe = await getDescribe(state, objectName);
  const fields = describe?.fields || [];
  const referenceFields = fields.filter((field) => field.type === "reference" && Array.isArray(field.referenceTo) && field.referenceTo.length > 0);

  const baseRecord = await querySingleRecord(state, objectName, recordId, ["Id", nameField, ...referenceFields.map((field) => field.name)]);
  if (!baseRecord) {
    throw new Error("Record introuvable: " + objectName + " / " + recordId);
  }

  const node = {
    key,
    recordId,
    objectName,
    label: baseRecord[nameField] || recordId,
    depth,
    relationLabel,
    parentKey,
    url: buildRecordUrl(recordId),
    children: []
  };

  state.nodes.set(key, node);

  if (depth >= state.maxDepth) {
    return node;
  }

  await appendParentRelations(node, baseRecord, referenceFields, depth, state);
  await appendChildRelations(node, describe, depth, state);

  return node;
}

async function appendParentRelations(node, record, referenceFields, depth, state) {
  for (const refField of referenceFields) {
    const linkedId = normalizeRecordId(record[refField.name]);
    if (!linkedId) continue;

    const targetObject = findObjectByRecordId(linkedId, state.prefixMap) || refField.referenceTo[0];
    if (!targetObject) continue;

    const sobjectMeta = state.objectByName.get(targetObject);
    if (!shouldKeepBusinessObject(sobjectMeta)) continue;

    const childNode = await buildNode(targetObject, linkedId, depth + 1, state, refField.label || refField.name, node.key);
    node.children.push(childNode.key);
    state.edges.push({ from: node.key, to: childNode.key, relation: refField.name, direction: "parent" });
  }
}

async function appendChildRelations(node, describe, depth, state) {
  const relationships = describe?.childRelationships || [];
  for (const rel of relationships) {
    if (!rel || !rel.childSObject || !rel.field) continue;
    if (rel.deprecatedAndHidden) continue;

    const childMeta = state.objectByName.get(rel.childSObject);
    if (!shouldKeepBusinessObject(childMeta)) continue;

    const childObject = rel.childSObject;
    const childNameField = await getNameField(state, childObject);
    const soql = [
      "SELECT Id",
      childNameField,
      "FROM " + childObject,
      "WHERE " + rel.field + " = '" + node.recordId + "'",
      "LIMIT " + String(state.childrenLimit)
    ].join(" ");

    let result;
    try {
      result = await sfRequest(state.apiVersion, "/query?q=" + encodeURIComponent(soql));
    } catch (_err) {
      continue;
    }

    const records = Array.isArray(result?.records) ? result.records : [];
    for (const child of records) {
      const childId = normalizeRecordId(child.Id);
      if (!childId) continue;

      const childNode = await buildNode(childObject, childId, depth + 1, state, rel.relationshipName || rel.field, node.key);
      node.children.push(childNode.key);
      state.edges.push({ from: node.key, to: childNode.key, relation: rel.relationshipName || rel.field, direction: "child" });
    }
  }
}
