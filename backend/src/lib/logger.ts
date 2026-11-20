type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
