import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { openDatabase } from '../src/db.js'
import { createReportService } from '../src/capabilities/reports/service.js'
import { appJwt, createGitHub } from '../src/github/client.js'
import { createBridge } from '../src/github/bridge.js'
import { createDiscordRelay } from '../src/github/discord-relay.js'
import { retryAfterMs } from '../src/lib/http.js'
import {
  reportMarker,
  commentMarker,
  hasMarker,
  ownsMarker,
} from '../src/github/markers.js'

const fields = {
  title: 'Invented title',
  version: 'fake version',
  server: 'Plex',
  happened: 'Invented collection fails',
  steps: 'Run Test Media',
}
const logger = { debug() {}, warn() {} }
const MAX_JOB_ATTEMPTS = 5

function setup(t) {
  const clock = Date.now() + 60000
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const reports = createReportService(store, { githubEnabled: true })
  const report = reports.create({
    guildId: 'scratch-guild',
    reporterId: 'fake-user',
    category: 'bug',
    fields,
    now: 0,
  })
  reports.attachThread(report.id, 'fake-thread', 'fake-control')
  reports.finish(report.id, 'fake-user')
  const issues = []
  const comments = []
  const requests = []
  const relayed = []
  let etag = '"one"'
  const github = {
    root: '/repos/Example/scratch',
    ensureLabels: async () => {},
    list: async (path) => (path.includes('/comments') ? comments : issues),
    request: async (method, path, body, options) => {
      requests.push({ method, path, body, options })
      if (method === 'POST' && path.endsWith('/issues')) {
        const issue = {
          ...body,
          number: issues.length + 1,
          user: { type: 'Bot' },
          html_url: 'https://github.com/Example/scratch/issues/1',
          state: 'open',
          labels: body.labels.map((name) => ({ name })),
          updated_at: '2026-11-02T12:00:00Z',
        }
        issues.push(issue)
        return { data: issue }
      }
      if (method === 'POST' && path.endsWith('/comments')) {
        const comment = {
          ...body,
          id: comments.length + 1,
          user: { type: 'Bot', login: 'fake-app[bot]' },
          created_at: '2026-11-02T12:00:00Z',
        }
        comments.push(comment)
        return { data: comment }
      }
      if (method === 'PATCH') {
        issues[0].state = body.state
        return { data: issues[0] }
      }
      if (/\/issues\/\d+$/.test(path)) return { data: issues[0] }
      if (options?.etag === etag) return { status: 304, etag }
      return { status: 200, data: issues, etag }
    },
  }
  const relay = {
    published: async () => {},
    issueState: async (report, issue) => relayed.push(['state', issue.state]),
    comment: async (report, comment) => {
      relayed.push(['comment', comment.id])
      return 'fake-discord-message'
    },
  }
  return {
    store,
    reports,
    report,
    github,
    issues,
    comments,
    requests,
    relayed,
    relay,
    change: () => {
      etag = '"two"'
    },
    bridge: () =>
      createBridge({ store, github, relay, logger, now: () => clock }),
  }
}

test('App JWT uses RS256 and installation tokens are cached', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const jwt = appJwt('123', privateKey, 1000000)
  const [header, payload, signature] = jwt.split('.')
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256')
  const claims = JSON.parse(Buffer.from(payload, 'base64url'))
  assert.equal(claims.exp - claims.iat, 600)
  assert.ok(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url')
    )
  )
  let exchanges = 0
  const client = createGitHub(
    {
      githubPrivateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      githubAppId: '123',
      githubInstallationId: '456',
      githubRepository: 'Example/scratch',
    },
    {
      now: () => 1000000,
      fetchFn: async (url, options) => {
        if (url.endsWith('/access_tokens')) {
          exchanges += 1
          return Response.json({
            token: 'fake-installation-token',
            expires_at: new Date(1000000 + 3600000).toISOString(),
          })
        }
        assert.equal(
          options.headers.Authorization,
          'Bearer fake-installation-token'
        )
        return Response.json([])
      },
    }
  )
  await client.list('/repos/Example/scratch/issues')
  await client.list('/repos/Example/scratch/issues')
  assert.equal(exchanges, 1)
})

test('racing publish requests produce one job and one issue', async (t) => {
  const env = setup(t)
  const publish = () =>
    env.reports.requestPublish(env.report.id, {
      staff: true,
      guildId: 'scratch-guild',
    })
  await Promise.all([
    Promise.resolve().then(publish),
    Promise.resolve().then(publish),
  ])
  const bridge = env.bridge()
  await Promise.all([bridge.runJobs(), bridge.runJobs()])
  assert.equal(env.issues.length, 1)
  assert.match(env.issues[0].body, /maintainerr-discord:report:/)
  assert.equal(env.reports.get(env.report.id).state, 'published')
})

test('restart after remote issue creation recovers through its marker', async (t) => {
  const env = setup(t)
  env.reports.requestPublish(env.report.id, {
    staff: true,
    guildId: 'scratch-guild',
  })
  env.issues.push({
    number: 99,
    user: { type: 'Bot' },
    body: reportMarker(env.report.id),
    html_url: 'https://github.com/Example/scratch/issues/99',
  })
  await env.bridge().runJobs()
  assert.equal(env.issues.length, 1)
  assert.equal(env.reports.get(env.report.id).issue_number, 99)
  assert.equal(
    env.requests.filter((request) => request.method === 'POST').length,
    0
  )
})

test('comment markers recover a crashed relay and bot comments never bounce back', async (t) => {
  const env = setup(t)
  env.reports.requestPublish(env.report.id, {
    staff: true,
    guildId: 'scratch-guild',
  })
  const bridge = env.bridge()
  await bridge.runJobs()
  env.comments.push({
    id: 55,
    body: commentMarker('fake-message'),
    user: { type: 'Bot' },
    created_at: '2026-11-02T12:00:00Z',
  })
  await bridge.relayReply({
    reportId: env.report.id,
    messageId: 'fake-message',
    author: 'fake',
    body: 'a human reply',
  })
  await bridge.relayReply({
    reportId: env.report.id,
    messageId: 'fake-message',
    author: 'fake',
    body: 'a human reply',
  })
  assert.equal(env.comments.length, 1)
  await bridge.poll()
  assert.equal(env.relayed.filter(([kind]) => kind === 'comment').length, 0)
  env.reports.queueReply(env.reports.get(env.report.id), {
    id: 'bot-message',
    author: { bot: true },
    content: 'relayed',
    attachments: { size: 0 },
  })
  assert.equal(
    env.store.db
      .prepare("SELECT count(*) AS count FROM jobs WHERE kind = 'comment'")
      .get().count,
    0
  )
  assert.ok(hasMarker('-# maintainerr-discord:github:55:0'))
})

test('user text cannot impersonate a bot-owned idempotency marker', () => {
  const marker = reportMarker('fake-id')
  assert.equal(
    ownsMarker({ user: { type: 'User' }, body: marker }, marker),
    false
  )
  assert.equal(
    ownsMarker(
      { user: { type: 'Bot' }, body: `quoted text\n${marker}` },
      marker
    ),
    false
  )
  assert.equal(
    ownsMarker({ user: { type: 'Bot' }, body: `${marker}\nreport` }, marker),
    true
  )
  // Once our own bot id is known, another app's bot cannot claim the marker.
  assert.equal(
    ownsMarker(
      { user: { type: 'Bot', id: 7 }, body: `${marker}\nx` },
      marker,
      7
    ),
    true
  )
  assert.equal(
    ownsMarker(
      { user: { type: 'Bot', id: 9 }, body: `${marker}\nx` },
      marker,
      7
    ),
    false
  )
})

test('Retry-After is read the same way for every client', () => {
  const now = 1000000
  const at = (value) =>
    retryAfterMs(new Headers(value ? { 'retry-after': value } : {}), now)
  assert.equal(at('5'), 5000)
  assert.equal(at('0'), 0, 'retry immediately is not the same as absent')
  assert.equal(at(new Date(now + 30000).toUTCString()), 30000)
  assert.equal(at(new Date(now - 30000).toUTCString()), 0, 'past dates clamp')
  assert.equal(at('soon'), null)
  assert.equal(at(null), null)
})

test('unchanged poll makes one conditional request and closing and replying change both states', async (t) => {
  const env = setup(t)
  env.reports.requestPublish(env.report.id, {
    staff: true,
    guildId: 'scratch-guild',
  })
  const bridge = env.bridge()
  await bridge.runJobs()
  env.issues[0].state = 'closed'
  env.issues[0].closed_at = '2026-11-02T12:00:00Z'
  // A maintainer's closing comment, posted before the close, keeps it closed.
  env.comments.push({
    id: 122,
    body: 'Fixed in the next release',
    user: { login: 'fake-maintainer', type: 'User' },
    created_at: '2026-11-02T11:59:59Z',
  })
  await bridge.poll()
  assert.equal(env.issues[0].state, 'closed')
  assert.deepEqual(env.relayed.at(-2), ['state', 'closed'])
  assert.deepEqual(env.relayed.at(-1), ['comment', 122])
  const before = env.requests.length
  await bridge.poll()
  assert.equal(env.requests.length - before, 1)
  assert.equal(env.requests.at(-1).options.etag, '"one"')
  env.change()
  env.comments.push({
    id: 123,
    body: 'Human reply',
    user: { login: 'fake-user', type: 'User' },
    created_at: '2026-11-02T12:00:01Z',
  })
  await bridge.poll()
  assert.equal(env.issues[0].state, 'open')
  assert.deepEqual(env.relayed.at(-1), ['comment', 123])
  env.change()
  await bridge.poll()
  assert.equal(env.relayed.filter(([kind]) => kind === 'comment').length, 2)
})

test('a rate limit stops the rest of the claimed work until it expires', async (t) => {
  const env = setup(t)
  const second = env.reports.create({
    guildId: 'scratch-guild',
    reporterId: 'another-user',
    category: 'bug',
    fields,
    now: 0,
  })
  env.reports.attachThread(second.id, 'another-thread', 'another-control')
  env.reports.finish(second.id, 'another-user')
  for (const report of [env.report, second])
    env.reports.requestPublish(report.id, {
      staff: true,
      guildId: 'scratch-guild',
    })
  let calls = 0
  env.github.list = async () => {
    calls += 1
    throw Object.assign(new Error('rate limited'), {
      status: 429,
      retryAt: Date.now() + 3600000,
    })
  }
  await env.bridge().runJobs()
  assert.equal(calls, 1)
  // The second job was never claimed, so it keeps all of its attempts.
  assert.deepEqual(
    env.store.db
      .prepare('SELECT attempts FROM jobs ORDER BY id')
      .all()
      .map((job) => job.attempts),
    [1, 0]
  )
})

test('a deleted report thread exhausts the job once and staff receive exactly one notice across restart', async (t) => {
  const env = setup(t)
  let clock = Date.now() + 60000
  const notices = []
  const warnings = []
  let attempts = 0
  const missingThread = () =>
    Object.assign(new Error('Unknown Channel'), { code: 10003 })
  const launcher = {
    messages: {
      fetch: async () => ({
        find: (predicate) => notices.find(predicate),
        size: notices.length,
        last: () => notices.at(-1),
      }),
    },
    send: async (message) => {
      const sent = {
        id: `notice-${notices.length + 1}`,
        ...message,
        author: { id: 'fake-bot' },
      }
      notices.push(sent)
      return sent
    },
  }
  const client = {
    user: { id: 'fake-bot' },
    channels: {
      fetch: async (id) => {
        if (id === 'fake-thread') throw missingThread()
        assert.equal(id, 'fake-launcher')
        return launcher
      },
    },
  }
  const ctx = {
    store: env.store,
    config: { launcherChannelId: 'fake-launcher', staffRoleId: 'fake-staff' },
    reports: {
      update: async () => {
        attempts += 1
        throw missingThread()
      },
    },
  }
  const bridge = () =>
    createBridge({
      store: env.store,
      github: env.github,
      relay: createDiscordRelay(client, ctx),
      logger: { debug() {}, warn: (...args) => warnings.push(args) },
      now: () => clock,
    })
  env.reports.requestPublish(env.report.id, {
    staff: true,
    guildId: 'scratch-guild',
  })
  const setCursor = env.store.setCursor.bind(env.store)
  let crash = true
  env.store.setCursor = (key, cursor, ...args) => {
    if (key.startsWith('job:failure:') && cursor === 'notified' && crash) {
      crash = false
      throw new Error('Crash after Discord accepted the notice')
    }
    return setCursor(key, cursor, ...args)
  }
  const worker = bridge()
  for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt += 1) {
    await worker.runJobs()
    const job = env.store.db.prepare('SELECT * FROM jobs').get()
    assert.equal(job.attempts, attempt)
    assert.equal(
      job.status,
      attempt === MAX_JOB_ATTEMPTS ? 'failed' : 'pending'
    )
    clock += 3600001
  }
  const failed = env.store.failedJobs()[0]
  assert.ok(failed.completed_at)
  assert.deepEqual(env.store.claimBatch({ now: clock }), [])
  assert.equal(notices.length, 1)
  assert.match(notices[0].content, /<@&fake-staff>/)
  assert.ok(notices[0].content.includes(env.report.id))
  assert.match(notices[0].content, /thread is deleted or inaccessible/)
  // The alert exists to reach a human, so the staff role must be allowed
  // through; parse stays empty so nothing else, including everyone, can ping.
  assert.deepEqual(notices[0].allowedMentions, {
    parse: [],
    roles: ['fake-staff'],
    users: [],
  })
  const restarted = bridge()
  for (let tick = 0; tick < 3; tick += 1) await restarted.runJobs()
  await restarted.poll()
  assert.equal(attempts, MAX_JOB_ATTEMPTS)
  assert.equal(notices.length, 1)
  assert.equal(warnings.length, 1)
  assert.equal(
    env.store.getCursor(`job:failure:${failed.created_at}:${failed.id}`).cursor,
    'notified'
  )
})

test('a failure notice keeps its launcher destination across permission recovery', async (t) => {
  for (const code of [50001, 50013, null]) {
    const store = openDatabase(':memory:')
    t.after(() => store.close())
    const sent = []
    let inaccessible = true
    const client = {
      user: { id: 'fake-bot' },
      channels: {
        fetch: async (id) => {
          if (id === 'fake-thread' && inaccessible) {
            if (code === null) return null
            throw Object.assign(new Error('Missing access or permissions'), {
              code,
            })
          }
          return {
            messages: {
              fetch: async () => ({
                find: (predicate) =>
                  sent
                    .filter((message) => message.channelId === id)
                    .find(predicate),
                size: sent.filter((message) => message.channelId === id).length,
              }),
            },
            send: async (message) => {
              const notice = {
                ...message,
                id: `notice-${sent.length}`,
                channelId: id,
                author: client.user,
              }
              sent.push(notice)
              return notice
            },
          }
        },
      },
    }
    const ctx = {
      store,
      config: { launcherChannelId: 'fake-launcher', staffRoleId: 'fake-staff' },
    }
    const report = {
      id: 'fake-report',
      guild_id: 'fake-guild',
      thread_id: 'fake-thread',
    }
    const job = { id: 1, created_at: 1000, kind: 'publish', attempts: 5 }
    await createDiscordRelay(client, ctx).failed(report, job)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].channelId, 'fake-launcher')
    inaccessible = false
    await createDiscordRelay(client, ctx).failed(report, job)
    assert.equal(
      sent.length,
      1,
      `Duplicate notice after permission recovery: ${code}`
    )
    // A healthy thread is the common destination, so it must ping staff too.
    await createDiscordRelay(client, ctx).failed(report, { ...job, id: 2 })
    assert.equal(sent[1].channelId, 'fake-thread')
    assert.deepEqual(sent[1].allowedMentions, {
      parse: [],
      roles: ['fake-staff'],
      users: [],
    })
  }
})

test('an unavailable Discord thread does not block polling other reports', async (t) => {
  for (const [code, size] of [10003, 50001, 50013].flatMap((code) =>
    [2, 100].map((size) => [code, size])
  )) {
    const env = setup(t)
    const other = env.reports.create({
      guildId: 'scratch-guild',
      reporterId: 'another-user',
      category: 'bug',
      fields,
      now: 0,
    })
    env.reports.attachThread(other.id, 'other-thread', 'other-control')
    env.reports.finish(other.id, 'another-user')
    for (const id of [env.report.id, other.id])
      env.reports.requestPublish(id, {
        staff: true,
        guildId: 'scratch-guild',
      })
    const bridge = env.bridge()
    await bridge.runJobs()
    env.store.setCursor('github:issues', '2026-11-02T11:59:00.000Z')
    env.issues[1].updated_at = '2026-11-02T12:05:00Z'
    for (let number = 3; number <= size; number += 1)
      env.issues.push({ number, updated_at: '2026-11-02T12:10:00Z' })
    env.github.request = async (method, path, body, options) => {
      if (options?.etag === 'unchanged') return { status: 304 }
      const since = new URL(`https://api.example.test${path}`).searchParams.get(
        'since'
      )
      return {
        status: 200,
        etag: 'unchanged',
        data: env.issues.filter(
          (issue) => Date.parse(issue.updated_at) > Date.parse(since)
        ),
      }
    }
    const comment = {
      id: 123,
      body: 'Recovered reply',
      user: { type: 'User', login: 'reporter' },
      created_at: '2026-11-02T12:00:01Z',
    }
    env.github.list = async (path) =>
      path.includes('/issues/1/comments') ? [comment] : []
    let inaccessible = true
    const states = []
    env.relay.issueState = async (report, issue) => {
      if (report.id === env.report.id && inaccessible)
        throw Object.assign(new Error('Thread unavailable'), { code })
      states.push([report.id, issue.state])
    }
    env.issues[1].state = 'closed'
    await bridge.poll()
    assert.deepEqual(states, [[other.id, 'closed']])
    if (code === 10003) {
      assert.ok(env.store.getCursor('discord:deleted-thread:fake-thread'))
      if (size === 100)
        assert.ok(
          env.store.getCursor('github:issues').cursor > env.issues[0].updated_at
        )
      continue
    }
    assert.equal(env.store.getCursor('github:issues').etag, null)
    await env.bridge().poll()
    inaccessible = false
    await env.bridge().poll()
    assert.equal(states.filter(([id]) => id === env.report.id).length, 1)
    assert.deepEqual(
      env.relayed.filter(([kind]) => kind === 'comment'),
      [['comment', 123]]
    )
    await env.bridge().poll()
    assert.equal(env.relayed.filter(([kind]) => kind === 'comment').length, 1)
  }
})

test('a changed repository stops the bridge reusing stored issue numbers', async (t) => {
  const env = setup(t)
  env.reports.requestPublish(env.report.id, {
    staff: true,
    guildId: 'scratch-guild',
  })
  await env.bridge().runJobs()
  assert.equal(env.issues.length, 1)
  const jobId = env.store.enqueue(
    'comment',
    {
      reportId: env.report.id,
      messageId: 10,
      author: 'reporter',
      body: 'Queued reply',
    },
    { dedupeKey: 'queued-reply', now: 0 }
  )
  const before = env.requests.length

  // Same /data, different GITHUB_REPOSITORY: issue 1 here is a different issue.
  env.github.root = '/repos/Example/production'
  const warnings = []
  const moved = createBridge({
    store: env.store,
    github: env.github,
    relay: env.relay,
    logger: { debug() {}, warn: (message) => warnings.push(message) },
  })
  await moved.poll()
  await moved.runJobs()
  await moved.publish(env.report.id)
  await moved.relayReply({ reportId: env.report.id, messageId: 9, body: 'x' })

  assert.equal(
    env.requests.length,
    before,
    'the bridge must not touch the new repository with stored mappings'
  )
  assert.equal(warnings.length, 1)
  assert.equal(
    env.store.db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)
      .status,
    'pending'
  )
  env.github.root = '/repos/example/SCRATCH'
  await moved.runJobs()
  assert.equal(env.comments.length, 1)
  assert.equal(
    env.store.db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)
      .status,
    'completed'
  )
})

test('unbound GitHub history is not silently assigned to a configured repository', async (t) => {
  for (const history of ['issue', 'attempt', 'sync', 'cursor']) {
    const env = setup(t)
    if (history === 'issue')
      env.store.db
        .prepare(
          "UPDATE reports SET state = 'published', issue_number = 7 WHERE id = ?"
        )
        .run(env.report.id)
    else if (history === 'attempt') {
      env.reports.requestPublish(env.report.id, {
        staff: true,
        guildId: 'scratch-guild',
      })
      env.store.claimBatch({ now: Date.now() + 60000 })
    } else if (history === 'sync')
      env.store.db
        .prepare('INSERT INTO sync VALUES (?, ?, ?, ?, ?)')
        .run('discord-github', '1', env.report.id, '7', 0)
    else env.store.setCursor('github:issues', '2026-11-02T00:00:00Z')
    const bridge = env.bridge()
    await bridge.poll()
    await bridge.runJobs()
    await bridge.publish(env.report.id)
    await bridge.relayReply({
      reportId: env.report.id,
      messageId: 9,
      body: 'A reply',
    })
    assert.equal(env.requests.length, 0, history)
    assert.equal(env.store.getCursor('github:repository'), undefined)
  }
})
