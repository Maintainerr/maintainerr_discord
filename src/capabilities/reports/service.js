import { randomUUID } from 'node:crypto'
import { redactSecrets, redactObject } from '../../lib/redaction.js'

export class ReportError extends Error {}
export const FIELD_LIMITS = {
  version: 150,
  server: 150,
  happened: 650,
  steps: 650,
}

export function createReportService(store, config) {
  const { db } = store
  const get = (id) => db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
  const own = (id, userId) => {
    const report = get(id)
    if (!report || report.reporter_id !== userId)
      throw new ReportError('Only the reporter can change this report.')
    return report
  }
  return {
    get,
    byThread: (id) =>
      db.prepare('SELECT * FROM reports WHERE thread_id = ?').get(id),
    pending: () =>
      db
        .prepare(
          "SELECT * FROM reports WHERE state IN ('collecting', 'triage', 'ready', 'publishing')"
        )
        .all(),
    create({ guildId, reporterId, category, fields, now = Date.now() }) {
      if (!['bug', 'feature', 'question'].includes(category))
        throw new ReportError('Choose a valid report category.')
      const clean = redactObject(fields)
      for (const key of Object.keys(FIELD_LIMITS)) {
        if (
          typeof clean[key] !== 'string' ||
          !clean[key].trim() ||
          clean[key].length > FIELD_LIMITS[key]
        )
          throw new ReportError(
            'Complete every field. Version and server details allow 150 characters; descriptions allow 650.'
          )
      }
      return store.transaction(() => {
        const recent = db
          .prepare(
            'SELECT count(*) AS count, max(created_at) AS latest FROM submissions WHERE reporter_id = ? AND created_at > ?'
          )
          .get(reporterId, now - 3600000)
        if (recent.count >= 3)
          throw new ReportError(
            'You can submit three reports per hour. Please try again later.'
          )
        if (recent.latest !== null && recent.latest > now - 30000)
          throw new ReportError('Please wait 30 seconds between reports.')
        const id = randomUUID()
        const state = 'collecting'
        db.prepare(
          `INSERT INTO reports (id, guild_id, reporter_id, category, state, title, fields, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          guildId,
          reporterId,
          category,
          state,
          clean.happened.trim().slice(0, 90),
          JSON.stringify(clean),
          now,
          now
        )
        db.prepare(
          'INSERT INTO submissions (reporter_id, report_id, created_at) VALUES (?, ?, ?)'
        ).run(reporterId, id, now)
        return get(id)
      })
    },
    attachThread(id, threadId, messageId) {
      db.prepare(
        'UPDATE reports SET thread_id = ?, control_message_id = ?, updated_at = ? WHERE id = ?'
      ).run(threadId, messageId, Date.now(), id)
    },
    finish(id, userId) {
      own(id, userId)
      if (
        !db
          .prepare(
            "UPDATE reports SET state = 'ready', updated_at = ? WHERE id = ? AND state = 'collecting'"
          )
          .run(Date.now(), id).changes
      )
        throw new ReportError('This report is not collecting files.')
      return get(id)
    },
    edit(id, userId, fields) {
      const report = own(id, userId)
      if (!['collecting', 'triage', 'ready'].includes(report.state))
        throw new ReportError('This report can no longer be edited.')
      const clean = redactObject(fields)
      for (const key of Object.keys(FIELD_LIMITS))
        if (
          typeof clean[key] !== 'string' ||
          !clean[key].trim() ||
          clean[key].length > FIELD_LIMITS[key]
        )
          throw new ReportError(
            'Complete every field. Version and server details allow 150 characters; descriptions allow 650.'
          )
      db.prepare(
        'UPDATE reports SET fields = ?, title = ?, updated_at = ? WHERE id = ?'
      ).run(
        JSON.stringify(clean),
        clean.happened.trim().slice(0, 90),
        Date.now(),
        id
      )
      return get(id)
    },
    cancel(id, userId) {
      const report = own(id, userId)
      if (!['collecting', 'triage', 'ready'].includes(report.state))
        throw new ReportError('This report can no longer be cancelled.')
      db.prepare(
        "UPDATE reports SET state = 'cancelled', updated_at = ? WHERE id = ?"
      ).run(Date.now(), id)
      return get(id)
    },
    addAttachment(id, userId, attachment) {
      return store.transaction(() => {
        const report = own(id, userId)
        if (report.state !== 'collecting')
          throw new ReportError('This report is not collecting files.')
        if (
          db
            .prepare(
              'SELECT count(*) AS count FROM attachments WHERE report_id = ?'
            )
            .get(id).count >= 10
        )
          throw new ReportError(
            'A report can contain at most ten files or pasted logs.'
          )
        const clean = redactObject(attachment)
        db.prepare(
          `INSERT INTO attachments (id, report_id, discord_id, filename, content_type, size, url, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(discord_id) DO NOTHING`
        ).run(
          randomUUID(),
          id,
          clean.discordId,
          clean.filename,
          clean.type,
          clean.size,
          clean.url ?? null,
          clean.content ?? null,
          Date.now()
        )
      })
    },
    attachments: (id) =>
      db
        .prepare(
          'SELECT * FROM attachments WHERE report_id = ? ORDER BY created_at'
        )
        .all(id),
    requestPublish() {
      throw new ReportError('GitHub publishing is disabled.')
    },
    queueReply() {},
  }
}
