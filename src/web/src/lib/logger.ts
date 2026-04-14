type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLogLevel(): LogLevel {
  try {
    const stored = localStorage.getItem("konomi-log-level");
    if (
      stored === "debug" ||
      stored === "info" ||
      stored === "warn" ||
      stored === "error"
    ) {
      return stored;
    }
  } catch {
    // ignore localStorage access failures
  }
  const href = typeof window !== "undefined" ? window.location.href : "";
  const isLikelyDev = href.startsWith("http://") || href.startsWith("https://");
  return isLikelyDev ? "debug" : "info";
}

const MIN_LOG_LEVEL = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[MIN_LOG_LEVEL];
}

function getConsoleFn(level: LogLevel): (...args: unknown[]) => void {
  if (level === "debug") return console.debug;
  if (level === "info") return console.info;
  if (level === "warn") return console.warn;
  return console.error;
}

function toErrorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

export type Logger = {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
  errorWithStack: (message: string, error: unknown, meta?: unknown) => void;
};

export function createLogger(scope: string): Logger {
  const write = (level: LogLevel, message: string, meta?: unknown): void => {
    if (!shouldLog(level)) return;
    const prefix = `[${new Date().toISOString()}] [${scope}]`;
    const fn = getConsoleFn(level);
    if (meta === undefined) {
      fn(`${prefix} ${message}`);
      return;
    }
    fn(`${prefix} ${message}`, meta);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    errorWithStack: (message, error, meta) =>
      write("error", message, {
        ...toErrorMeta(error),
        ...(meta && typeof meta === "object" ? (meta as object) : {}),
      }),
  };
}
