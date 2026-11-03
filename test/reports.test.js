import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChannelType, Collection } from 'discord.js'
import { openDatabase } from '../src/db.js'
import { createReportService } from '../src/capabilities/reports/service.js'
import { createReportDiscord } from '../src/capabilities/reports/discord.js'
import { createDiscordRelay } from '../src/github/discord-relay.js'
import { createProvider } from '../src/llm/provider.js'
import { redactSecrets } from '../src/lib/redaction.js'
import {
  classifyAttachment,
  downloadAttachment,
} from '../src/lib/attachments.js'

const fields = {
  version: '3.0 container',
  server: 'Plex',
  happened: 'Invented collection does not match',
  steps: 'Run Test Media',
}
const reportInput = (now) => ({
  guildId: 'fake-guild',
  reporterId: 'fake-user',
  category: 'bug',
  fields,
  now,
})

test('redaction covers each support ecosystem and preserves surrounding text', () => {
  const cases = [
    ['X-Plex-Token=plexFake123', 'plexFake123'],
    ['api_key=jellyfinFake456', 'jellyfinFake456'],
    ['X-Emby-Token: embyFake789', 'embyFake789'],
    ['X-Api-Key: seerrFake123', 'seerrFake123'],
    ['Radarr apikey=radarrFake456', 'radarrFake456'],
    ['Sonarr apikey=sonarrFake789', 'sonarrFake789'],
    ['Tautulli apikey=tautulliFake123', 'tautulliFake123'],
    ['qBittorrent password="qb fake secret"', 'qb fake secret'],
    ['username=qbFakeUser', 'qbFakeUser'],
    ['http://fakeUser:fakePassword@torrent.local:8080', 'fakePassword'],
    [
      'https://discord.com/api/webhooks/123456789012345678/webhookFake123',
      'webhookFake123',
    ],
    ['postgresql://fakeUser:dbFakePassword@db.local/app', 'dbFakePassword'],
    ['Authorization: Bearer bearerFake123', 'bearerFake123'],
    ['/home/fakeUser/media', 'fakeUser'],
    ['/Users/fakeUser/logs', 'fakeUser'],
    ['C:\\Users\\fakeUser\\logs', 'fakeUser'],
    ['"api_key": "jsonFake123"', 'jsonFake123'],
    [
      JSON.stringify(JSON.stringify({ apikey: 'escapedFake123' })),
      'escapedFake123',
    ],
    ['"X-Plex-Token": "nestedPlex123"', 'nestedPlex123'],
  ]
  for (const [input, secret] of cases) {
    // Unquoted values run to end of line, so context sits on its own lines.
    const result = redactSecrets(`before\n${input}\nafter`)
    assert.ok(!result.includes(secret), input)
    assert.ok(result.startsWith('before\n'), input)
    assert.ok(result.endsWith('\nafter'), input)
  }
})

test('third report in an hour succeeds, fourth fails, cooldown and hour boundaries work', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const reports = createReportService(store, {})
  reports.create(reportInput(0))
  assert.throws(() => reports.create(reportInput(29999)), /30 seconds/)
  reports.create(reportInput(30000))
  reports.create(reportInput(60000))
  assert.throws(() => reports.create(reportInput(90000)), /three reports/)
  assert.doesNotThrow(() => reports.create(reportInput(3600000)))
})

test('collecting report and redacted logs survive a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'maintainerr-report-'))
  let store = openDatabase(join(directory, 'bot.sqlite'))
  try {
    const reports = createReportService(store, {})
    const report = reports.create({
      ...reportInput(0),
      fields: { ...fields, happened: 'Failure with apikey=privateFakeSecret' },
    })
    reports.attachThread(report.id, 'fake-thread', 'fake-control')
    reports.addAttachment(report.id, 'fake-user', {
      discordId: 'fake-file',
      filename: 'sample.log',
      type: 'text/plain',
      size: 50,
      content: 'X-Plex-Token=logFakeSecret',
    })
    store.close()
    store = openDatabase(join(directory, 'bot.sqlite'))
    const restored = createReportService(store, {})
    assert.equal(restored.get(report.id).state, 'collecting')
    assert.equal(restored.get(report.id).thread_id, 'fake-thread')
    assert.doesNotMatch(restored.get(report.id).fields, /privateFakeSecret/)
    assert.doesNotMatch(
      restored.attachments(report.id)[0].content,
      /logFakeSecret/
    )
    assert.throws(
      () => restored.finish(report.id, 'other-user'),
      /Only the reporter/
    )
  } finally {
    store.close()
    rmSync(directory, { recursive: true })
  }
})

test('publishing requires staff and a completed collection, and queues only once', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const reports = createReportService(store, { githubEnabled: true })
  const report = reports.create(reportInput(0))
  reports.attachThread(report.id, 'fake-thread', 'fake-control')
  assert.throws(
    () =>
      reports.requestPublish(report.id, {
        staff: false,
        guildId: 'fake-guild',
      }),
    /staff/
  )
  assert.throws(
    () =>
      reports.requestPublish(report.id, { staff: true, guildId: 'fake-guild' }),
    /finish/
  )
  reports.finish(report.id, 'fake-user')
  reports.requestPublish(report.id, { staff: true, guildId: 'fake-guild' })
  reports.requestPublish(report.id, { staff: true, guildId: 'fake-guild' })
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM jobs').get().count,
    1
  )
  assert.throws(() => reports.edit(report.id, 'fake-user', fields), /no longer/)
})

test('resolved triage never queues an issue and unresolved triage collects files', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const reports = createReportService(store, {
    featureTriage: true,
    githubEnabled: true,
  })
  const report = reports.create({ ...reportInput(0), category: 'question' })
  assert.equal(report.state, 'triage')
  reports.triage(report.id, 'fake-user', true)
  assert.equal(reports.get(report.id).state, 'resolved')
  assert.throws(
    () =>
      reports.requestPublish(report.id, { staff: true, guildId: 'fake-guild' }),
    /finish/
  )
  assert.equal(
    store.db.prepare('SELECT count(*) AS count FROM jobs').get().count,
    0
  )
  const another = reports.create({
    ...reportInput(30000),
    category: 'question',
  })
  assert.equal(
    reports.triage(another.id, 'fake-user', false).state,
    'collecting'
  )
})

test('triage restoration and concurrent delivery spend quota and post an answer only once', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const config = {
    featureTriage: true,
    forumChannelId: 'forum',
    launcherChannelId: 'launcher',
  }
  const reports = createReportService(store, config)
  const report = reports.create({ ...reportInput(0), category: 'question' })
  reports.attachThread(report.id, 'thread', 'control')
  const messages = new Collection()
  const client = {
    user: { id: 'bot' },
    channels: { fetch: async (id) => channels.get(id) },
  }
  const launcher = {
    id: 'launch-message',
    author: client.user,
    components: [{ components: [{ customId: 'report:start' }] }],
    edit: async () => launcher,
  }
  store.setCursor('reports:launcher', launcher.id)
  const channels = new Map([
    ['forum', { type: ChannelType.GuildForum, guildId: 'fake-guild' }],
    [
      'launcher',
      {
        guildId: 'fake-guild',
        isTextBased: () => true,
        messages: { fetch: async () => launcher },
      },
    ],
    [
      'thread',
      {
        id: 'thread',
        members: { add: async () => {} },
        messages: { fetch: async () => messages, edit: async () => {} },
        send: async (message) => {
          const sent = {
            ...message,
            id: `answer-${messages.size}`,
            author: client.user,
          }
          messages.set(sent.id, sent)
          return sent
        },
      },
    ],
  ])
  let calls = 0
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test', llmModel: 'fake', llmDailyLimit: 5 },
    store,
    {
      now: () => 0,
      queue: { run: (fn) => fn() },
      fetchFn: async () => {
        calls += 1
        return Response.json({
          choices: [{ message: { content: 'Documented advice.' } }],
        })
      },
    }
  )
  const ctx = {
    config,
    store,
    logger: { debug() {} },
    answer: (question) =>
      provider.complete({ system: 'Use docs only', user: question }),
  }
  ctx.relay = createDiscordRelay(client, ctx)
  const first = createReportDiscord(client, ctx)
  await Promise.all([first.ready(), first.ready()])
  ctx.relay = createDiscordRelay(client, ctx)
  await createReportDiscord(client, ctx).ready()
  assert.equal(messages.size, 1)
  assert.equal(calls, 1)
  assert.equal(JSON.parse(store.getCursor('llm:daily').cursor).used, 1)
  assert.equal(reports.get(report.id).state, 'triage')
})

test('attachment allowlist rejects size, executables and disguised binary files', async () => {
  assert.match(
    classifyAttachment(
      { name: 'large.png', size: 101, contentType: 'image/png' },
      100
    ).error,
    /100 bytes/
  )
  assert.match(
    classifyAttachment(
      { name: 'app.exe', size: 10, contentType: 'application/octet-stream' },
      100
    ).error,
    /Only/
  )
  const file = {
    name: 'fake.log',
    size: 4,
    contentType: 'text/plain',
    url: 'https://cdn.discordapp.com/attachments/fake/log',
  }
  await assert.rejects(
    downloadAttachment(
      file,
      100,
      async () => new Response(Buffer.from('PK\u0000\u0000'))
    ),
    /binary/
  )
  await assert.rejects(
    downloadAttachment(
      { ...file, name: 'fake.png', contentType: 'image/png' },
      100,
      async () => new Response('not an image')
    ),
    /does not match/
  )
  await assert.rejects(
    downloadAttachment({ ...file, url: 'http://internal.local/log' }, 100),
    /Discord hosting/
  )
})
