/**
 * Structured logging (checklist §35). One JSON object per line in production so a log drain can
 * index fields; readable single lines in development.
 */
type Level = "debug" | "info" | "warn" | "error";

const PROD = process.env.NODE_ENV === "production";
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) || (PROD ? "info" : "info");
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;
  if (process.env.VITEST && level !== "error") return;
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const line = PROD
    ? JSON.stringify(entry)
    : `[wesify] ${level.toUpperCase()} ${msg}${Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

export function errorFields(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) return { error: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") };
  return { error: String(err) };
}
