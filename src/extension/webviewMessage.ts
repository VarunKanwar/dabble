import type { ViewMode, WebviewToExtensionMessage } from "../shared/protocol";
import { isLocalSourceKind, isS3SourceFormat } from "../shared/sourceKinds";

export function parseWebviewMessage(message: unknown): WebviewToExtensionMessage | null {
  if (!isRecord(message) || typeof message.type !== "string") {
    return null;
  }

  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "runQuery":
      return typeof message.sql === "string" ? { type: "runQuery", sql: message.sql } : null;
    case "loadMoreQueryRows":
      return { type: "loadMoreQueryRows" };
    case "loadAllQueryRows":
      return { type: "loadAllQueryRows" };
    case "selectColumn":
      return typeof message.columnName === "string"
        ? { type: "selectColumn", columnName: message.columnName }
        : null;
    case "selectTable":
      return typeof message.tableName === "string"
        ? { type: "selectTable", tableName: message.tableName }
        : null;
    case "switchMode":
      return isViewMode(message.mode) ? { type: "switchMode", mode: message.mode } : null;
    case "browseLocal":
      return isLocalSourceKind(message.kind) ? { type: "browseLocal", kind: message.kind } : null;
    case "openSource":
      if (!isRecord(message.source)) {
        return null;
      }
      return {
        type: "openSource",
        source: {
          localType: isLocalSourceKind(message.source.localType) ? message.source.localType : undefined,
          path: typeof message.source.path === "string" ? message.source.path : undefined,
          s3Profile: typeof message.source.s3Profile === "string" ? message.source.s3Profile : null,
          s3Format: isS3SourceFormat(message.source.s3Format) ? message.source.s3Format : undefined
        }
      };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "clicked" || value === "connect";
}
