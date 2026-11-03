import { discordMarker } from './markers.js'
import { safeMessage } from '../lib/http.js'
import { chunkText } from '../lib/chunking.js'

export function createDiscordRelay(client, ctx) {
  const locks = new Map()
  const relay = {
    async sendOnce(threadId, id, content) {
      const key = `${threadId}:${id}`
      if (locks.has(key)) return locks.get(key)
      const work = (async () => {
        const thread = await client.channels.fetch(threadId)
        if (!thread)
          throw Object.assign(new Error('Discord channel is unavailable.'), {
            code: 50001,
          })
        if (thread.archived) await thread.setArchived(false)
        const marker = discordMarker(id)
        let before
        while (true) {
          const messages = await thread.messages.fetch({
            limit: 100,
            ...(before ? { before } : {}),
          })
          const found = messages.find(
            (message) =>
              message.author.id === client.user.id &&
              message.content.endsWith(`\n${marker}`)
          )
          if (found) return found.id
          if (messages.size < 100) break
          before = messages.last().id
        }
        return (await thread.send(safeMessage(`${content}\n${marker}`))).id
      })()
      locks.set(key, work)
      try {
        return await work
      } finally {
        locks.delete(key)
      }
    },
    async issueState(report, issue) {
      const thread = await client.channels.fetch(report.thread_id)
      if (!thread)
        throw Object.assign(new Error('Discord channel is unavailable.'), {
          code: 50001,
        })
      const forum = await client.channels.fetch(thread.parentId)
      if (!forum)
        throw Object.assign(new Error('Discord forum is unavailable.'), {
          code: 50001,
        })
      const labels = new Set(
        issue.labels.map((label) =>
          typeof label === 'string' ? label : label.name
        )
      )
      const tags = (forum.availableTags ?? [])
        .filter((tag) => labels.has(tag.name))
        .map((tag) => tag.id)
        .slice(0, 5)
      if (thread.archived) await thread.setArchived(false)
      if (tags.join(',') !== [...thread.appliedTags].join(','))
        await thread.setAppliedTags(tags)
      if (issue.state === 'closed') await thread.setArchived(true)
    },
    async published(report, issue) {
      await ctx.reports.update(report)
      await relay.sendOnce(
        report.thread_id,
        `published:${report.id}`,
        `Published to GitHub: ${issue.html_url}`
      )
    },
    async failed(report, job) {
      const id = `failed-job:${job.created_at}:${job.id}`
      const key = `job:failure:${job.created_at}:${job.id}`
      const content =
        `<@&${ctx.config.staffRoleId}> Report ${report.id}: ${job.kind} stopped after ${job.attempts} attempts. ` +
        'Check the report and service permissions before retrying manually.'
      const fallback = () =>
        relay.sendOnce(
          ctx.config.launcherChannelId,
          id,
          `${content}\nThe report thread is deleted or inaccessible: https://discord.com/channels/${report.guild_id}/${report.thread_id}`
        )
      if (ctx.store.getCursor(key)?.cursor === 'launcher') return fallback()
      try {
        return await relay.sendOnce(report.thread_id, id, content)
      } catch (err) {
        if (err.code !== 10003 && err.code !== 50001 && err.code !== 50013)
          throw err
        if (err.code === 10003)
          ctx.store.setCursor(
            `discord:deleted-thread:${report.thread_id}`,
            'true'
          )
        // Recovery must search the channel that may already contain the notice.
        ctx.store.setCursor(key, 'launcher')
        return fallback()
      }
    },
    async comment(report, comment) {
      let remoteId
      const text = `**GitHub Reply from ${comment.user.login}**\n${comment.body}`
      for (const [index, chunk] of chunkText(text, 1700).entries())
        remoteId = await relay.sendOnce(
          report.thread_id,
          `github:${comment.id}:${index}`,
          chunk
        )
      return remoteId
    },
  }
  return relay
}
