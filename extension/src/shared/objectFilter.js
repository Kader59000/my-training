const EXCLUDED_OBJECT_PREFIXES = [
  "Apex", "Auth", "ConnectedApplication", "ContentAsset", "Dashboard", "DataDetect", "Document", "Duplicate", "Email", "Entity", "External", "Flow", "Folder", "Installed", "Knowledge", "Login", "Matching", "Metadata", "Network", "Oauth", "Permission", "Platform", "Process", "Profile", "Queue", "RecordType", "Setup", "Site", "StaticResource", "UserPreference", "UserRole", "Vote"
];

const EXCLUDED_OBJECT_SUFFIXES = [
  "History", "Share", "Feed", "Tag", "OwnerSharingRule", "ChangeEvent", "DataType"
];

const EXCLUDED_OBJECT_EXACT = new Set([
  "User",
  "Group",
  "CollaborationGroup",
  "AsyncApexJob",
  "CronTrigger",
  "EntitySubscription"
]);

export function isConfigObjectName(objectName) {
  const name = String(objectName || "").trim();
  if (!name) return true;
  if (EXCLUDED_OBJECT_EXACT.has(name)) return true;
  for (const p of EXCLUDED_OBJECT_PREFIXES) {
    if (name.startsWith(p)) return true;
  }
  for (const s of EXCLUDED_OBJECT_SUFFIXES) {
    if (name.endsWith(s)) return true;
  }
  return false;
}

