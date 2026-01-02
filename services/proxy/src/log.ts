const isProd = process.env.NODE_ENV === 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  source: string;
  timestamp: string;
  [key: string]: unknown;
}

export function createLogger(source: string) {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    const entry: LogEntry = {
      level,
      message,
      source,
      timestamp: new Date().toISOString(),
      ...data,
    };

    const consoleMethod = level === 'debug' ? 'log' : level;

    if (isProd) {
      console[consoleMethod](JSON.stringify(entry));
    } else {
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      console[consoleMethod](`${entry.timestamp} ${level} [${source}] ${message}${dataStr}`);
    }
  };

  return {
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
  };
}
