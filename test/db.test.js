import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db.js'

const MAX_JOB_ATTEMPTS = 5
const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

test('schema is idempotent and SQLite enables the required pragmas', (t) => {
  const path = mkdtempSync(join(tmpdir(), 'maintainerr-db-'))
  const store = openDatabase(join(path, 'bot.sqlite'))
  t.after(() => {
    store.close()
    rmSync(path, { recursive: true })
  })
  store.applySchema()
  assert.equal(
    store.db.prepare('PRAGMA journal_mode').get().journal_mode,
    'wal'
  )
  assert.equal(store.db.prepare('PRAGMA synchronous').get().synchronous, 1)
  assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout, 5000)
})

test('duplicate dedupe keys are rejected even after completion', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  store.enqueue(
    'publish',
    { id: 'fake-report' },
    { dedupeKey: 'publish:fake', now: 0 }
  )
  assert.throws(
    () => store.enqueue('publish', {}, { dedupeKey: 'publish:fake' }),
    /UNIQUE/
  )
  const [job] = store.claimBatch({ now: 0 })
  assert.ok(store.complete(job, 1))
  assert.throws(
    () => store.enqueue('publish', {}, { dedupeKey: 'publish:fake' }),
    /UNIQUE/
  )
  assert.deepEqual(store.claimBatch({ now: 999999 }), [])
})

test('leases exclude other claims and stale owners cannot complete or retry', (t) => {
  const path = mkdtempSync(join(tmpdir(), 'maintainerr-lease-'))
  const first = openDatabase(join(path, 'bot.sqlite'))
  const second = openDatabase(join(path, 'bot.sqlite'))
  t.after(() => {
    first.close()
    second.close()
    rmSync(path, { recursive: true })
  })
  first.enqueue('publish', {}, { dedupeKey: 'one', now: 0 })
  const [oldJob] = first.claimBatch({ now: 0, leaseMs: 100 })
  assert.deepEqual(second.claimBatch({ now: 99 }), [])
  const [newJob] = second.claimBatch({ now: 100 })
  assert.notEqual(oldJob.lease_token, newJob.lease_token)
  assert.equal(first.complete(oldJob, 101), false)
  assert.equal(first.retry(oldJob, 'old failure', { now: 101 }), false)
  assert.ok(second.complete(newJob, 101))
})

test('retry backoff increases and pending jobs survive reopening', () => {
  const path = mkdtempSync(join(tmpdir(), 'maintainerr-retry-'))
  let store = openDatabase(join(path, 'bot.sqlite'))
  try {
    store.enqueue('publish', {}, { dedupeKey: 'one', now: 0 })
    let [job] = store.claimBatch({ now: 0 })
    store.retry(job, 'first failure', { now: 0 })
    assert.deepEqual(store.claimBatch({ now: 999 }), [])
    ;[job] = store.claimBatch({ now: 1000 })
    store.retry(job, 'second failure', { now: 1000 })
    store.close()
    store = openDatabase(join(path, 'bot.sqlite'))
    assert.deepEqual(store.claimBatch({ now: 2999 }), [])
    ;[job] = store.claimBatch({ now: 3000 })
    assert.equal(job.attempts, 3)
    store.complete(job, 3001)
    assert.deepEqual(store.claimBatch({ now: 999999 }), [])
  } finally {
    store.close()
    rmSync(path, { recursive: true })
  }
})

test('daily quota stops at its boundary and resets on a UTC day change', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const now = Date.parse('2026-11-02T23:59:59Z')
  assert.equal(store.consumeDaily('llm:quota', 2, now), true)
  assert.equal(store.consumeDaily('llm:quota', 2, now), true)
  assert.equal(store.consumeDaily('llm:quota', 2, now), false)
  assert.equal(store.consumeDaily('llm:quota', 2, now + 1000), true)
})

test('retry exhaustion and an expired final lease stop further job claims', (t) => {
  for (const mode of ['retry', 'expired lease']) {
    const store = openDatabase(':memory:')
    t.after(() => store.close())
    store.enqueue('publish', {}, { dedupeKey: 'deleted-thread', now: 0 })
    let clock = 0
    for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt += 1) {
      const [job] = store.claimBatch({ now: clock, leaseMs: 100 })
      assert.equal(job.attempts, attempt)
      if (mode === 'retry') {
        assert.equal(store.retry(job, 'Unknown Channel', { now: clock }), true)
        clock += 3600001
      } else clock += 100
    }
    assert.deepEqual(store.claimBatch({ now: clock }), [])
    assert.equal(store.failedJobs()[0].status, 'failed')
    assert.equal(store.failedJobs()[0].attempts, MAX_JOB_ATTEMPTS)
    assert.deepEqual(store.claimBatch({ now: JOB_RETENTION_MS }), [])
  }
})

test('retention prunes old terminal jobs and preserves the boundary and active jobs', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const now = JOB_RETENTION_MS + 1000
  const insert = store.db.prepare(
    `INSERT INTO jobs (kind, payload, status, available_at, created_at, completed_at, dedupe_key)
    VALUES ('publish', '{}', ?, 0, 0, ?, ?)`
  )
  const oldCompleted = Number(
    insert.run('completed', 999, 'old-completed').lastInsertRowid
  )
  const oldFailed = Number(
    insert.run('failed', 999, 'old-failed').lastInsertRowid
  )
  const boundaryCompleted = Number(
    insert.run('completed', 1000, 'boundary-completed').lastInsertRowid
  )
  const recentFailed = Number(
    insert.run('failed', 1001, 'recent-failed').lastInsertRowid
  )
  const pending = Number(insert.run('pending', null, 'pending').lastInsertRowid)
  const running = Number(insert.run('running', null, 'running').lastInsertRowid)
  store.setCursor(`job:failure:0:${oldFailed}`, 'notified')
  store.setCursor(`job:failure:0:${recentFailed}`, 'notified')
  assert.equal(store.pruneJobs(now), 2)
  assert.deepEqual(
    store.db
      .prepare('SELECT id FROM jobs ORDER BY id')
      .all()
      .map((job) => job.id),
    [boundaryCompleted, recentFailed, pending, running]
  )
  assert.equal(
    store.db.prepare('SELECT id FROM jobs WHERE id = ?').get(oldCompleted),
    undefined
  )
  assert.equal(store.getCursor(`job:failure:0:${oldFailed}`), undefined)
  assert.equal(
    store.getCursor(`job:failure:0:${recentFailed}`).cursor,
    'notified'
  )
})
