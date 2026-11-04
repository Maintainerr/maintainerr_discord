import {
  reportMarker,
  commentMarker,
  hasMarker,
  ownsMarker,
} from './markers.js'
import { redactSecrets } from '../lib/redaction.js'
import { describeError } from '../lib/logging.js'
import { MAX_JOB_ATTEMPTS } from '../db.js'

export function issueBody(report, attachments) {
  const fields = JSON.parse(report.fields)
  return `${reportMarker(report.id)}\n${redactSecrets(
    [
      '## Bug Report from Discord',
      `**Version and Install Method**\n${fields.version}`,
      `**Media Server**\n${fields.server}`,
      `**What Happened**\n${fields.happened}`,
      `**Steps to Reproduce**\n${fields.steps}`,
      ...attachments.map((file) =>
        file.content
          ? `**${file.filename}**\n\n\`\`\`text\n${file.content.slice(0, 3000).replaceAll('```', "'''")}\n\`\`\``
          : `**${file.filename}**: see the Discord thread.`
      ),
      `Discord thread: https://discord.com/channels/${report.guild_id}/${report.thread_id}`,
    ].join('\n\n')
  ).slice(0, 60000)}`
}

export function createBridge({ store, github, relay, logger, now = Date.now }) {
  const { db } = store
  // Our own bot user id, learned from the first issue or comment we write, so a
  // different app on the repository cannot claim one of our markers.
  let botId
  const bot = () => {
    if (botId === undefined)
      botId = Number(store.getCursor('github:bot')?.cursor) || null
    return botId
  }
  // Repository-relative history cannot safely be reassigned to a different target.
  let mismatchLogged = false
  const repositoryChanged = () => {
    const root = github.root.toLowerCase()
    const stored = store.transaction(() => {
      const previous = store.getCursor('github:repository')?.cursor
      if (previous) return previous.toLowerCase()
      const history = db
        .prepare(
          `SELECT
        EXISTS(SELECT 1 FROM reports WHERE issue_number IS NOT NULL) OR
        EXISTS(SELECT 1 FROM jobs WHERE kind IN ('publish', 'comment') AND attempts > 0) OR
        EXISTS(SELECT 1 FROM sync) OR
        EXISTS(SELECT 1 FROM poll_cursor WHERE key LIKE 'github:%') AS found`
        )
        .get().found
      if (history) return null
      store.setCursor('github:repository', root, null, now())
      return root
    })
    if (stored === root) return false
    if (!mismatchLogged) {
      mismatchLogged = true
      logger.warn(
        `GitHub sync is disabled: stored history belongs to ${stored ?? 'an unknown repository'}, not ${github.root}. ` +
          'Restore the original repository binding or use a fresh database.'
      )
    }
    return true
  }

  const rememberBot = (item) => {
    if (bot() || item?.user?.type !== 'Bot' || !item.user.id) return
    botId = item.user.id
    store.setCursor('github:bot', String(botId), null, now())
  }
  let timer
  let active
  let nextPoll = 0
  let blockedUntil = 0
  let labelsReady = false
  const get = (id) => db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
  const synced = (direction, id) =>
    db
      .prepare('SELECT * FROM sync WHERE direction = ? AND source_id = ?')
      .get(direction, String(id))
  const record = (direction, source, reportId, remote) =>
    db
      .prepare(
        `INSERT INTO sync (direction, source_id, report_id, remote_id, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(direction, source_id) DO NOTHING`
      )
      .run(direction, String(source), reportId, String(remote), now())

  const bridge = {
    async publish(reportId) {
      if (repositoryChanged()) return
      let report = get(reportId)
      if (!report || !['publishing', 'published'].includes(report.state)) return
      let issue
      if (report.issue_number)
        issue = (
          await github.request(
            'GET',
            `${github.root}/issues/${report.issue_number}`
          )
        ).data
      else {
        const marker = reportMarker(report.id)
        const existing = await github.list(
          `${github.root}/issues?state=all&labels=source%3Adiscord&per_page=100`
        )
        issue = existing.find(
          (item) => !item.pull_request && ownsMarker(item, marker, bot())
        )
        if (!issue) {
          if (!labelsReady) {
            await github.ensureLabels()
            labelsReady = true
          }
          issue = (
            await github.request('POST', `${github.root}/issues`, {
              title: redactSecrets(report.title),
              body: issueBody(
                report,
                db
                  .prepare('SELECT * FROM attachments WHERE report_id = ?')
                  .all(report.id)
              ),
              labels: ['source:discord', 'bug'],
            })
          ).data
        }
        rememberBot(issue)
        db.prepare(
          "UPDATE reports SET state = 'published', issue_number = ?, updated_at = ? WHERE id = ?"
        ).run(issue.number, now(), report.id)
      }
      report = get(reportId)
      await relay.published(report, issue)
    },
    async relayReply(payload) {
      if (repositoryChanged()) return
      const report = get(payload.reportId)
      if (
        !report?.issue_number ||
        synced('discord-github', payload.messageId) ||
        hasMarker(payload.body)
      )
        return
      const marker = commentMarker(payload.messageId)
      const comments = await github.list(
        `${github.root}/issues/${report.issue_number}/comments?per_page=100`
      )
      let comment = comments.find((item) => ownsMarker(item, marker, bot()))
      if (!comment) {
        await github.request(
          'PATCH',
          `${github.root}/issues/${report.issue_number}`,
          { state: 'open' }
        )
        comment = (
          await github.request(
            'POST',
            `${github.root}/issues/${report.issue_number}/comments`,
            {
              body: `${marker}\n**Discord Reply from ${redactSecrets(payload.author)}**\n\n${redactSecrets(payload.body)}`,
            }
          )
        ).data
      }
      rememberBot(comment)
      record('discord-github', payload.messageId, report.id, comment.id)
    },
    async poll() {
      if (repositoryChanged()) return
      const cursor = store.getCursor('github:issues')
      const since = cursor?.cursor || new Date(now() - 60000).toISOString()
      const path = `${github.root}/issues?state=all&sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(since)}`
      const response = await github.request('GET', path, undefined, {
        etag: cursor?.etag,
      })
      if (response.status === 304) return
      const issues = [...response.data]
      if (response.next) issues.push(...(await github.list(response.next)))
      let retry = false
      for (const issue of issues) {
        const report = db
          .prepare('SELECT * FROM reports WHERE issue_number = ?')
          .get(issue.number)
        if (
          !report ||
          issue.pull_request ||
          store.getCursor(`discord:deleted-thread:${report.thread_id}`)
        )
          continue
        try {
          await relay.issueState(report, issue)
        } catch (err) {
          if (![10003, 50001, 50013].includes(err.code)) throw err
          if (err.code === 10003) {
            store.setCursor(
              `discord:deleted-thread:${report.thread_id}`,
              'true'
            )
          } else retry = true
          continue
        }
        const previous = store.getCursor(`github:comments:${issue.number}`)
        const commentsSince =
          previous?.cursor || new Date(report.created_at).toISOString()
        const commentsPath = `${github.root}/issues/${issue.number}/comments?per_page=100&since=${encodeURIComponent(commentsSince)}`
        const comments = await github.list(commentsPath)
        let latest = commentsSince
        for (const comment of comments) {
          if (
            !hasMarker(comment.body) &&
            comment.user.type !== 'Bot' &&
            !synced('github-discord', comment.id)
          ) {
            // Only a reply after the close reopens; a closing comment
            // posted just before it must not undo the close.
            if (
              issue.state === 'closed' &&
              comment.created_at > issue.closed_at
            )
              await github.request(
                'PATCH',
                `${github.root}/issues/${issue.number}`,
                { state: 'open' }
              )
            const remoteId = await relay.comment(report, {
              ...comment,
              body: redactSecrets(comment.body || ''),
              user: {
                ...comment.user,
                login: redactSecrets(comment.user.login),
              },
            })
            record('github-discord', comment.id, report.id, remoteId)
          }
          if ((comment.updated_at || comment.created_at) > latest)
            latest = comment.updated_at || comment.created_at
        }
        store.setCursor(`github:comments:${issue.number}`, latest)
      }
      // Keep the query stable for 304s. Advance the window after a full page.
      const watermark = issues.reduce(
        (latest, issue) =>
          issue.updated_at > latest ? issue.updated_at : latest,
        since
      )
      const advanced =
        !retry && issues.length >= 100 && watermark > since
          ? new Date(Date.parse(watermark) - 1000).toISOString()
          : since
      // A 304 would hide undelivered updates even after Discord access recovers.
      store.setCursor(
        'github:issues',
        advanced,
        !retry && advanced === since ? response.etag : null
      )
    },
    async runJobs() {
      if (repositoryChanged()) return
      // One claim at a time: a rate limit must stop the rest of the batch, and
      // claiming spends an attempt.
      for (let count = 0; count < 3 && now() >= blockedUntil; count += 1) {
        const [job] = store.claimBatch({ limit: 1, now: now() })
        if (!job) break
        try {
          if (job.kind === 'publish') await bridge.publish(job.payload.reportId)
          else if (job.kind === 'comment') await bridge.relayReply(job.payload)
          else throw new Error(`Unknown job kind: ${job.kind}`)
          store.complete(job, now())
        } catch (err) {
          if (err.status === 403 || err.status === 429)
            blockedUntil = Math.max(blockedUntil, err.retryAt || now() + 60000)
          const retried = store.retry(job, redactSecrets(err.message), {
            now: now(),
            baseDelayMs: Math.max(1000, blockedUntil - now()),
          })
          if (retried && job.attempts < MAX_JOB_ATTEMPTS)
            logger.debug(`Job ${job.id} will retry:`, describeError(err))
        }
      }
      for (const job of store.failedJobs()) {
        const key = `job:failure:${job.created_at}:${job.id}`
        const notice = store.getCursor(key)
        if (notice?.cursor === 'notified') continue
        if (!notice) {
          store.setCursor(key, 'pending', null, now())
          logger.warn(
            `Job ${job.id} stopped after ${job.attempts} attempts. Staff must check the report and service permissions:`
          )
          logger.debug(`Job ${job.id} failed:`, job.last_error)
        }
        const report = get(job.payload.reportId)
        if (!report) {
          store.setCursor(key, 'notified', null, now())
          continue
        }
        try {
          await relay.failed(report, job)
          store.setCursor(key, 'notified', null, now())
        } catch {
          // Keep only the notice pending while Discord is unavailable.
        }
      }
      store.pruneJobs(now())
    },
    start() {
      if (timer) return
      const tick = () => {
        if (active || now() < blockedUntil) return
        active = (async () => {
          await bridge.runJobs()
          if (now() >= nextPoll && now() >= blockedUntil) {
            nextPoll = now() + 60000
            await bridge.poll()
          }
        })()
          .catch((err) => {
            if (err.status === 403 || err.status === 429)
              blockedUntil = err.retryAt || now() + 60000
            logger.warn(
              'GitHub sync failed. Check the App configuration and permissions.'
            )
            logger.debug(describeError(err))
          })
          .finally(() => {
            active = null
          })
      }
      timer = setInterval(tick, 5000)
      timer.unref()
      tick()
    },
    async stop() {
      clearInterval(timer)
      timer = null
      await active
    },
  }
  return bridge
}
