import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
export const MAX_JOB_ATTEMPTS = 5
const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function openDatabase(path = '/data/bot.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;'
  )
  db.exec(schema)

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const store = {
    db,
    transaction,
    close: () => db.close(),
    applySchema: () => db.exec(schema),
    enqueue(kind, payload, { dedupeKey, now = Date.now() }) {
      return Number(
        db
          .prepare(
            `INSERT INTO jobs
        (kind, payload, dedupe_key, available_at, created_at) VALUES (?, ?, ?, ?, ?)`
          )
          .run(kind, JSON.stringify(payload), dedupeKey, now, now)
          .lastInsertRowid
      )
    },
    claimBatch({
      limit = 10,
      leaseMs = 300000,
      owner = 'bot',
      now = Date.now(),
    } = {}) {
      return transaction(() => {
        db.prepare(
          `UPDATE jobs SET status = 'failed', completed_at = ?,
          last_error = COALESCE(last_error, 'Final job lease expired.'),
          lease_owner = NULL, lease_token = NULL, lease_until = NULL
          WHERE attempts >= ? AND (status = 'pending' OR
          (status = 'running' AND lease_until <= ?))`
        ).run(now, MAX_JOB_ATTEMPTS, now)
        const ready = db
          .prepare(
            `SELECT * FROM jobs WHERE
          (status = 'pending' AND available_at <= ?) OR
          (status = 'running' AND lease_until <= ?) ORDER BY id LIMIT ?`
          )
          .all(now, now, limit)
        return ready.map((job) => {
          const token = randomUUID()
          db.prepare(
            `UPDATE jobs SET status = 'running', attempts = attempts + 1,
            lease_owner = ?, lease_token = ?, lease_until = ? WHERE id = ?`
          ).run(owner, token, now + leaseMs, job.id)
          return {
            ...job,
            status: 'running',
            attempts: job.attempts + 1,
            payload: JSON.parse(job.payload),
            lease_token: token,
            lease_until: now + leaseMs,
          }
        })
      })
    },
    complete(job, now = Date.now()) {
      return (
        db
          .prepare(
            `UPDATE jobs SET status = 'completed', completed_at = ?,
        lease_owner = NULL, lease_token = NULL, lease_until = NULL
        WHERE id = ? AND status = 'running' AND lease_token = ? AND lease_until > ?`
          )
          .run(now, job.id, job.lease_token, now).changes === 1
      )
    },
    retry(
      job,
      error,
      { now = Date.now(), baseDelayMs = 1000, maxDelayMs = 3600000 } = {}
    ) {
      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** Math.min(job.attempts - 1, 20)
      )
      const failed = job.attempts >= MAX_JOB_ATTEMPTS
      return (
        db
          .prepare(
            `UPDATE jobs SET status = ?, available_at = ?, last_error = ?, completed_at = ?,
        lease_owner = NULL, lease_token = NULL, lease_until = NULL
        WHERE id = ? AND status = 'running' AND lease_token = ? AND lease_until > ?`
          )
          .run(
            failed ? 'failed' : 'pending',
            now + delay,
            error,
            failed ? now : null,
            job.id,
            job.lease_token,
            now
          ).changes === 1
      )
    },
    failedJobs() {
      return db
        .prepare("SELECT * FROM jobs WHERE status = 'failed'")
        .all()
        .map((job) => ({ ...job, payload: JSON.parse(job.payload) }))
    },
    pruneJobs(now = Date.now()) {
      return transaction(() => {
        db.prepare(
          `DELETE FROM poll_cursor WHERE key IN (
          SELECT 'job:failure:' || created_at || ':' || id FROM jobs
          WHERE status IN ('completed', 'failed') AND completed_at < ?)`
        ).run(now - JOB_RETENTION_MS)
        return db
          .prepare(
            "DELETE FROM jobs WHERE status IN ('completed', 'failed') AND completed_at < ?"
          )
          .run(now - JOB_RETENTION_MS).changes
      })
    },
    getCursor(key) {
      return db.prepare('SELECT * FROM poll_cursor WHERE key = ?').get(key)
    },
    setCursor(key, cursor, etag = null, now = Date.now()) {
      db.prepare(
        `INSERT INTO poll_cursor (key, cursor, etag, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET cursor=excluded.cursor, etag=excluded.etag,
        updated_at=excluded.updated_at`
      ).run(key, cursor, etag, now)
    },
    deleteCursor(key) {
      db.prepare('DELETE FROM poll_cursor WHERE key = ?').run(key)
    },
    consumeDaily(key, limit, now = Date.now()) {
      return transaction(() => {
        const day = new Date(now).toISOString().slice(0, 10)
        const stored = this.getCursor(key)
        const previous = stored ? JSON.parse(stored.cursor) : {}
        const used = previous.day === day ? previous.used : 0
        if (used >= limit) return false
        this.setCursor(key, JSON.stringify({ day, used: used + 1 }), null, now)
        return true
      })
    },
  }
  store.pruneJobs()
  return store
}
