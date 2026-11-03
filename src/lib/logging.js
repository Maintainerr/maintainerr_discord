import { redactSecrets } from './redaction.js'

export function describeError(err, depth = 0) {
  if (typeof err === 'string') return redactSecrets(err)
  if (!err || typeof err !== 'object') return err
  if (depth > 3) return '[cause chain truncated]'

  // requestBody contains the user's pasted content and must never be logged.
  const described = {
    name: err.name,
    message:
      typeof err.message === 'string'
        ? redactSecrets(err.message)
        : err.message,
    code: err.code,
    status: err.status,
    method: err.method,
    stack: typeof err.stack === 'string' ? redactSecrets(err.stack) : undefined,
  }

  if ('url' in err) described.url = redactSecrets(err.url)
  if (err.cause) described.cause = describeError(err.cause, depth + 1)

  return described
}

export function createLogger(level = 'debug', output = console) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 }
  const methods = { debug: 'debug', log: 'info', warn: 'warn', error: 'error' }

  return Object.fromEntries(
    Object.entries(methods).map(([method, severity]) => [
      method,
      (...args) => {
        if (levels[severity] < levels[level]) return
        output[method](
          ...args.map((value) => {
            if (value instanceof Error) return describeError(value)
            return typeof value === 'string' ? redactSecrets(value) : value
          })
        )
      },
    ])
  )
}
