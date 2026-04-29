export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

export function numericValue(value: unknown): number {
  const normalized = String(value ?? "").replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatPercent(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  if (numeric === 0) {
    return "0%";
  }
  if (numeric < 0.1) {
    return "<0.1%";
  }
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric < 10 ? 1 : 0,
    minimumFractionDigits: numeric < 1 ? 1 : 0
  }).format(numeric)}%`;
}

export function formatDisplayNumber(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value ?? "");
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

export function resultMeta(rowCount: number): string {
  return `${rowCount} rows`;
}

export function typeGlyph(type: string): string {
  const upper = String(type || "").toUpperCase();
  if (/DATE|TIME/.test(upper)) {
    return "◔";
  }
  if (/BOOL/.test(upper)) {
    return "◦";
  }
  if (/INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT|BIGINT/.test(upper)) {
    return "#";
  }
  return "T";
}

export function lastSegment(value: string): string {
  const segments = String(value || "").split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || value;
}
