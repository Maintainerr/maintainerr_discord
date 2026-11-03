import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/db.js'
import { RequestQueue, createProvider } from '../src/llm/provider.js'

test('a burst waits for tokens, stays serial, and recovers after a failed task', async () => {
  let clock = 0
  const waits = []
  const queue = new RequestQueue({
    rpm: 2,
    now: () => clock,
    wait: async (delay) => {
      waits.push(delay)
      clock += delay
    },
  })
  const calls = []
  const tasks = [0, 1, 2].map((id) =>
    queue.run(async () => {
      calls.push([id, clock])
      if (id === 1) throw new Error('fake failure')
      return id
    })
  )
  const result = await Promise.allSettled(tasks)
  assert.deepEqual(calls, [
    [0, 0],
    [1, 30000],
    [2, 60000],
  ])
  assert.deepEqual(waits, [30000, 30000])
  assert.equal(result[2].value, 2)
})

test('429 is retried and outgoing prompts are redacted', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const requests = []
  const waits = []
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test/v1', llmModel: 'fake', llmDailyLimit: 5 },
    store,
    {
      queue: { run: (fn) => fn() },
      wait: async (delay) => waits.push(delay),
      fetchFn: async (url, options) => {
        requests.push({ url, body: options.body })
        return requests.length === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
          : Response.json({
              choices: [{ message: { content: 'Grounded answer' } }],
            })
      },
    }
  )
  assert.equal(
    await provider.complete({
      system: 'Use docs only',
      user: 'X-Plex-Token=private-fake-token',
    }),
    'Grounded answer'
  )
  assert.equal(requests.length, 2)
  assert.deepEqual(waits, [2000])
  assert.equal(requests[0].url, 'http://local.test/v1/chat/completions')
  assert.doesNotMatch(requests[0].body, /private-fake-token/)
})

test('daily quota prevents another network request and resets tomorrow', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  let clock = Date.parse('2026-11-02T23:59:59Z')
  let requests = 0
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test', llmModel: 'fake', llmDailyLimit: 1 },
    store,
    {
      now: () => clock,
      queue: { run: (fn) => fn() },
      fetchFn: async () => {
        requests += 1
        return Response.json({ choices: [{ message: { content: 'answer' } }] })
      },
    }
  )
  await provider.complete({ system: '', user: 'one' })
  await assert.rejects(provider.complete({ system: '', user: 'two' }), /quota/)
  assert.equal(requests, 1)
  clock += 1000
  await provider.complete({ system: '', user: 'three' })
  assert.equal(requests, 2)
})

test('two 429 retries and a successful response consume one logical daily unit', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  let requests = 0
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test', llmModel: 'fake', llmDailyLimit: 10 },
    store,
    {
      queue: { run: (fn) => fn() },
      wait: async () => {},
      fetchFn: async () => {
        requests += 1
        return requests <= 2
          ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
          : Response.json({ choices: [{ message: { content: 'answer' } }] })
      },
    }
  )
  await provider.complete({ system: 'Use docs only', user: 'Plex connection' })
  assert.equal(requests, 3)
  assert.equal(JSON.parse(store.getCursor('llm:daily').cursor).used, 1)
})

test('provider requests never contain env-style credentials from pasted configuration', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  let outgoing
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test', llmModel: 'fake', llmDailyLimit: 10 },
    store,
    {
      queue: { run: (fn) => fn() },
      fetchFn: async (url, options) => {
        outgoing = options.body
        return Response.json({ choices: [{ message: { content: 'answer' } }] })
      },
    }
  )
  await provider.complete({
    system: 'Use docs only',
    user: 'PLEX_TOKEN=fakePlex111\nRADARR_API_KEY=fakeRadarr333\nclient_secret: fakeClient444\nAuthorization: Token fakeAuth555',
  })
  assert.doesNotMatch(
    outgoing,
    /fakePlex111|fakeRadarr333|fakeClient444|fakeAuth555/
  )
})

test('a 429 holds every queued request, not only the one that got it', async () => {
  let clock = 0
  const queue = new RequestQueue({
    rpm: 60,
    now: () => clock,
    wait: async (delay) => {
      clock += delay
    },
  })
  const sent = []
  const store = { consumeDaily: () => true, getCursor: () => null }
  const provider = createProvider(
    { llmBaseUrl: 'http://local.test/v1', llmModel: 'fake', llmDailyLimit: 99 },
    store,
    {
      queue,
      now: () => clock,
      // The retrying request sleeps in real time without moving the clock, so
      // only the queue can advance it. That is what isolates the shared hold.
      wait: async () => {},
      fetchFn: async () => {
        sent.push(clock)
        return sent.length === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '10' } })
          : Response.json({ choices: [{ message: { content: 'ok' } }] })
      },
    }
  )
  await Promise.all([
    provider.complete({ system: '', user: 'one' }),
    provider.complete({ system: '', user: 'two' }),
  ])
  assert.equal(sent[0], 0)
  for (const at of sent.slice(1))
    assert.ok(at >= 10000, `sent at ${at} during the declared cooldown`)
})
