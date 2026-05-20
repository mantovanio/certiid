export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id:      number
  ts:      Date
  level:   LogLevel
  module:  string
  message: string
  data?:   unknown
}

const MAX     = 300
const buffer: LogEntry[] = []
let   seq     = 0

const STYLE: Record<LogLevel, string> = {
  info:  'color:#22c55e;font-weight:bold',
  warn:  'color:#f59e0b;font-weight:bold',
  error: 'color:#ef4444;font-weight:bold',
}

function add(level: LogLevel, module: string, message: string, data?: unknown) {
  const entry: LogEntry = { id: ++seq, ts: new Date(), level, module, message, data }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.shift()
  ;(window as unknown as Record<string, unknown>).__certiidLogs = buffer

  if (data !== undefined) {
    console[level](`%c[${module}]%c ${message}`, STYLE[level], '', data)
  } else {
    console[level](`%c[${module}]%c ${message}`, STYLE[level], '')
  }
}

export const logger = {
  info:    (module: string, msg: string, data?: unknown) => add('info',  module, msg, data),
  warn:    (module: string, msg: string, data?: unknown) => add('warn',  module, msg, data),
  error:   (module: string, msg: string, data?: unknown) => add('error', module, msg, data),
  entries: (): LogEntry[] => [...buffer].reverse(),
  clear:   () => { buffer.length = 0 },
}
