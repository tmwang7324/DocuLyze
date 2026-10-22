import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createLogger, format, transports, type Logger, type LoggerOptions } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

type LogLevel = "error" | "warn" | "info" | "debug";
export type OperationCategory = "server-action" | "intermediate function" | "database op";

// This is the complete vocabulary for structured server-operation logging.
// Keeping the classification next to the log writer makes a missing category
// impossible when a new operation is introduced.
const OPERATION_CATEGORIES = {
  getPresignedUrl: "server-action",
  finalizeUpload: "server-action",
  getReadPresignedURL: "server-action",
  removeDocument: "server-action",
  createRefresh: "server-action",
  revokeSession: "server-action",
  chatTurn: "server-action",
  validateUploadClaim: "intermediate function",
  publishIngestJob: "intermediate function",
  publishDeleteJob: "intermediate function",
  createChannel: "intermediate function",
  createUserProfile: "database op",
  mintDocumentRecord: "database op",
  finalizeDocumentRecord: "database op",
  reapStalePendingDocuments: "database op",
  listDocuments: "database op",
} as const satisfies Record<string, OperationCategory>;

export type OperationName = keyof typeof OPERATION_CATEGORIES;

type RequestContext = {
  requestId: string;
};

export type OperationalEvent = {
  operation: OperationName;
  lifecycle: string;
  [key: string]: unknown;
};

const requestContext = new AsyncLocalStorage<RequestContext>();
const SENSITIVE_KEY = /(?:password|token|cookie|authorization|signed.?url|filename|file_name|title|content|body)/i;
const DEFAULT_LOG_FILE_PATH = "logs/operational-%DATE%.jsonl";

// Winston's default JSON formatter uses a stable serializer that sorts keys.
// Rebuild the info object before serializing so JSONL preserves the useful
// leading columns: category, operation, lifecycle, then level.
const operationalJsonFormat = format.combine(
  format((info) => {
    const { category, operation, lifecycle, level, ...details } = info;
    for (const key of Object.keys(info)) delete info[key];
    Object.assign(info, { category, operation, lifecycle, level, ...details });
    return info;
  })(),
  format.printf((info) => JSON.stringify(info)),
);

function configuredLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  return level === "error" || level === "warn" || level === "debug" || level === "info"
    ? level
    : "info";
}

function ignoreLoggerErrors(target: Logger): Logger {
  target.on("error", () => undefined);
  return target;
}

function dailyLogFilePath(): string {
  const configuredPath = process.env.LOG_FILE_PATH || DEFAULT_LOG_FILE_PATH;
  if (configuredPath.includes("%DATE%")) return configuredPath;

  const parsed = path.parse(configuredPath);
  return path.join(parsed.dir, `${parsed.name}-%DATE%${parsed.ext || ".jsonl"}`);
}

function createDefaultTransport(): LoggerOptions["transports"] {
  if (process.env.NODE_ENV === "production") {
    return new transports.Console({ stderrLevels: ["error"] });
  }

  try {
    const filename = dailyLogFilePath();
    mkdirSync(path.dirname(filename), { recursive: true });

    // Keep a bounded, one-file-per-day JSONL history for local diagnosis.
    return new DailyRotateFile({
      filename,
      datePattern: "YYYY-MM-DD",
      maxFiles: "7d",
    });
  } catch {
    // A broken local destination must not prevent the application from starting.
    return new transports.Console({ stderrLevels: ["error"] });
  }
}

export function createOperationalLogger(options: Partial<LoggerOptions> = {}): Logger {
  return ignoreLoggerErrors(createLogger({
    level: configuredLevel(),
    format: operationalJsonFormat,
    ...options,
    transports: options.transports ?? createDefaultTransport(),
  }));
}

let logger = createOperationalLogger();

function safeValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(process.env.LOG_LEVEL === "debug" && value.stack ? { stack: value.stack } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => safeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      safeValue(entryValue, entryKey),
    ]));
  }
  return value;
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function runWithRequestContext<T>(operation: () => T): T {
  if (requestContext.getStore()) return operation();
  return requestContext.run({ requestId: randomUUID() }, operation);
}

export function logOperationalEvent(level: LogLevel, event: OperationalEvent): void {
  try {
    const safeEvent = safeValue(event) as OperationalEvent;
    // Property insertion order is intentional: the category and operation are
    // the leading fields in each JSONL event, ahead of lifecycle metadata.
    const { operation, category: _callerCategory, ...details } = safeEvent;
    logger.log(level, {
      category: OPERATION_CATEGORIES[operation],
      operation,
      ...details,
      requestId: getRequestId() ?? randomUUID(),
    });
  } catch {
    // Operational logging must never affect an application operation.
  }
}

export function setOperationalLoggerForTests(testLogger: Logger): void {
  logger = ignoreLoggerErrors(testLogger);
}

export function resetOperationalLoggerForTests(): void {
  logger = createOperationalLogger();
}
