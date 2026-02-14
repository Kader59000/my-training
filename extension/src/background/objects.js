export const ALLOWED_OBJECTS = new Set(["Account", "Contact", "Case"]);

export const NAME_FIELD_BY_OBJECT = new Map([
  ["Account", "Name"],
  ["Contact", "Name"],
  ["Case", "CaseNumber"]
]);

// Standard key prefixes for standard objects.
export const PREFIX_TO_OBJECT = new Map([
  ["001", "Account"],
  ["003", "Contact"],
  ["500", "Case"]
]);

export function isAllowedObject(objectName) {
  return ALLOWED_OBJECTS.has(objectName);
}

export function findObjectByRecordId(recordId) {
  if (!recordId) return null;
  return PREFIX_TO_OBJECT.get(String(recordId).substring(0, 3)) || null;
}

export function getNameField(objectName) {
  return NAME_FIELD_BY_OBJECT.get(objectName) || "Name";
}
