import test from 'node:test'
import assert from 'node:assert/strict'
import { redactTokens } from '../src/lib/redaction.js'
import { createLogger, describeError } from '../src/lib/logging.js'

test('redacts Discord REST tokens while preserving diagnostic URL context', () => {
  const cases = [
    [
      'POST https://discord.com/api/v10/interactions/123456789012345678/fake.token-123/callback',
      'POST https://discord.com/api/v10/interactions/123456789012345678/[redacted]/callback',
    ],
    [
      'PATCH https://discord.com/api/v10/webhooks/123456789012345678/fake_token-456/messages/@original?wait=true#response',
      'PATCH https://discord.com/api/v10/webhooks/123456789012345678/[redacted]/messages/@original?wait=true#response',
    ],
    [
      '/interactions/1/fakeToken /webhooks/12345678901234567890/otherToken',
      '/interactions/1/[redacted] /webhooks/12345678901234567890/[redacted]',
    ],
    ['Discord returned status 403', 'Discord returned status 403'],
  ]

  for (const [input, expected] of cases) {
    assert.equal(redactTokens(input), expected)
  }
})

test('error descriptions redact tokens in messages, stacks, URLs and causes', () => {
  const path =
    '/webhooks/123456789012345678/fakePrivateToken/messages/@original'
  const error = Object.assign(new Error(`Request failed at ${path}`), {
    code: 50007,
    status: 403,
    method: 'POST',
    url: `https://discord.com/api/v10${path}`,
    requestBody: { content: 'private pasted payload' },
    cause: new Error(`Nested request failed at ${path}`),
  })
  const described = describeError(error)
  const serialized = JSON.stringify(described)

  assert.doesNotMatch(
    serialized,
    /fakePrivateToken|private pasted payload|requestBody/
  )
  assert.match(described.message, /\[redacted\]/)
  assert.match(described.stack, /\[redacted\]/)
  assert.match(described.url, /\[redacted\]/)
  assert.match(described.cause.message, /\[redacted\]/)
  assert.match(described.cause.stack, /\[redacted\]/)
  assert.equal(described.code, 50007)
  assert.equal(described.status, 403)
  assert.equal(described.method, 'POST')
})

test('plain errors and string rejections cannot leak tokens without a URL field', () => {
  const path = '/interactions/123456789012345678/fakePrivateToken/callback'
  const described = describeError(new Error(`Failed ${path}`))
  assert.doesNotMatch(JSON.stringify(described), /fakePrivateToken/)
  assert.equal(
    describeError(path),
    '/interactions/123456789012345678/[redacted]/callback'
  )
  assert.equal(describeError(null), null)
  assert.equal(describeError(undefined), undefined)
})

test('cyclic causes are bounded and remain serializable', () => {
  const error = new Error('cyclic failure')
  error.cause = error
  const described = describeError(error)
  assert.equal(described.cause.cause.cause.cause, '[cause chain truncated]')
  assert.doesNotThrow(() => JSON.stringify(described))
})

test('logging defaults to debug and respects configured severity', () => {
  const entries = []
  const output = Object.fromEntries(
    ['debug', 'log', 'warn', 'error'].map((method) => [
      method,
      (...args) => entries.push([method, ...args]),
    ])
  )
  createLogger(undefined, output).debug('startup')
  const logger = createLogger('warn', output)
  logger.debug('hidden debug')
  logger.log('hidden info')
  logger.warn('needs attention')
  logger.error(new Error('failure at /interactions/1/fakeToken/callback'))
  createLogger('silent', output).error('hidden error')

  assert.deepEqual(entries.slice(0, 2), [
    ['debug', 'startup'],
    ['warn', 'needs attention'],
  ])
  assert.equal(entries.length, 3)
  assert.equal(entries[2][0], 'error')
  assert.match(entries[2][1].message, /\[redacted\]/)
  assert.doesNotMatch(JSON.stringify(entries), /fakeToken/)
})
