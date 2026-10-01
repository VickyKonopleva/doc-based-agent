import fs from "node:fs";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/**
 * stdio transport owns stdout — every byte written there must be JSON-RPC.
 * Everything we log therefore goes to stderr and, optionally, to a file.
 */
export function createLogger(level: Level, logFile = ""): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const stream = logFile ? fs.createWriteStream(logFile, { flags: "a" }) : null;

  const emit = (lvl: Level, msg: string, meta?: unknown) => {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...(meta === undefined ? {} : { meta: safe(meta) }),
    });
    process.stderr.write(line + "\n");
    stream?.write(line + "\n");
  };

  return {
    debug: (m, x) => emit("debug", m, x),
    info: (m, x) => emit("info", m, x),
    warn: (m, x) => emit("warn", m, x),
    error: (m, x) => emit("error", m, x),
  };
}

function safe(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}
