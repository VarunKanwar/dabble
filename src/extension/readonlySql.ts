const ALLOWED_READONLY_KEYWORDS = new Set([
  "select",
  "with",
  "show",
  "describe",
  "summarize",
  "from",
  "values"
]);

export function enforceReadonlySql(sql: string): string {
  const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!trimmed) {
    throw new Error("Enter a SQL query to run.");
  }

  const normalized = trimmed.replace(/--.*$/gm, "").trim().toLowerCase();
  const firstWord = normalized.split(/\s+/)[0];

  if (!ALLOWED_READONLY_KEYWORDS.has(firstWord)) {
    throw new Error("Dabble only allows readonly queries: SELECT, WITH, SHOW, DESCRIBE, SUMMARIZE, FROM, VALUES.");
  }

  return trimmed;
}
