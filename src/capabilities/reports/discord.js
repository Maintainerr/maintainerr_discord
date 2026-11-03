import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
} from 'discord.js'
import { createReportService, ReportError, FIELD_LIMITS } from './service.js'
import { safeMessage } from '../../lib/http.js'
import { downloadAttachment } from '../../lib/attachments.js'
import { describeError } from '../../lib/logging.js'
import { supportChannels } from '../welcome/index.js'

// Only bugs become GitHub issues. Feature ideas and questions are sent to the
// places that handle them.
const FEATURES_URL = 'https://features.maintainerr.info/'
const choices = [
  ['bug', 'Report a Bug', 'Something in Maintainerr is broken.'],
  ['feature', 'Suggest a Feature', 'Ideas go to the feature board.'],
  ['question', 'Ask a Question', 'Get help in the support forums.'],
]
const redirects = {
  feature: () =>
    `Feature ideas go to the feature board at ${FEATURES_URL}. Search it first, and vote if your idea is already there.`,
  question: (config) => {
    const help = supportChannels(config) || 'the support forums'
    return `Ask in ${help}, where a maintainer or another member can help.${config.featureSupport ? ' You can also try `/ask`, which searches the documentation.' : ''}`
  },
}
const fieldLabels = {
  version: 'Maintainerr Version and Install Method',
  server: 'Media Server and Version',
  happened: 'What Happened',
  steps: 'Steps to Reproduce',
}
const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style)
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons)
// Offered where an answer did not help, so a bug can skip the category step.
export const bugReportRow = () => row(button('report:bug', 'Report a Bug'))

export function reportControls(report) {
  if (!['collecting', 'ready'].includes(report.state)) return []
  const buttons =
    report.state === 'collecting'
      ? [
          button(`report:done:${report.id}`, 'Done', ButtonStyle.Primary),
          button(`report:done:${report.id}:none`, 'No Files'),
        ]
      : []
  buttons.push(
    button(`report:edit:${report.id}`, 'Edit'),
    button(`report:cancel:${report.id}`, 'Cancel'),
    button(`report:staff:${report.id}`, 'Staff Actions')
  )
  return [row(...buttons)]
}

export function reportSummary(report) {
  const fields = JSON.parse(report.fields)
  return `**Bug Report**\nState: ${report.state}\n\n${Object.entries(
    fieldLabels
  )
    .map(([key, label]) => `**${label}**\n${fields[key]}`)
    .join('\n\n')}\n\nReport ID: ${report.id}`
}

function reportModal(report) {
  const modal = new ModalBuilder()
    .setCustomId(report ? `report:save:${report.id}` : 'report:create:bug')
    .setTitle('Bug Report')
  const fields = report ? JSON.parse(report.fields) : {}
  for (const [key, label] of Object.entries(fieldLabels)) {
    const input = new TextInputBuilder()
      .setCustomId(key)
      .setLabel(label)
      .setStyle(
        key === 'version' || key === 'server'
          ? TextInputStyle.Short
          : TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setMaxLength(FIELD_LIMITS[key])
    if (fields[key]) input.setValue(fields[key])
    modal.addComponents(new ActionRowBuilder().addComponents(input))
  }
  return modal
}

async function findThread(forum, suffix) {
  const active = await forum.threads.fetchActive()
  const found = active.threads.find((thread) => thread.name.endsWith(suffix))
  if (found) return found
  let before
  do {
    const archived = await forum.threads.fetchArchived({
      type: 'public',
      limit: 100,
      ...(before ? { before } : {}),
    })
    const match = archived.threads.find((thread) =>
      thread.name.endsWith(suffix)
    )
    if (match) return match
    if (!archived.hasMore || !archived.threads.size) return null
    before = archived.threads.last().archiveTimestamp
  } while (before)
}

export function createReportDiscord(client, ctx) {
  const service = createReportService(ctx.store, ctx.config)
  let forum
  const fetchThread = async (id) => {
    const thread = await client.channels.fetch(id)
    if (!thread)
      throw Object.assign(new Error('Discord channel is unavailable.'), {
        code: 50001,
      })
    return thread
  }
  async function update(report) {
    if (!report.thread_id) return
    const thread = await fetchThread(report.thread_id)
    if (thread.archived) await thread.setArchived(false)
    if (report.control_message_id)
      await thread.messages.edit(report.control_message_id, {
        ...safeMessage(reportSummary(report)),
        components: reportControls(report),
      })
    if (['cancelled', 'resolved'].includes(report.state))
      await thread.setArchived(true)
  }
  async function ensureThread(report) {
    if (report.thread_id) {
      const thread = await fetchThread(report.thread_id)
      if (thread.archived) await thread.setArchived(false)
      await thread.members.add(report.reporter_id)
      return thread
    }
    const suffix = `[${report.id.slice(0, 8)}]`
    let thread = await findThread(forum, suffix)
    if (!thread)
      thread = await forum.threads.create({
        name: `${report.title.replace(/\s+/g, ' ').slice(0, 85)} ${suffix}`,
        autoArchiveDuration: 1440,
        message: {
          ...safeMessage(reportSummary(report)),
          components: reportControls(report),
        },
      })
    if (thread.archived) await thread.setArchived(false)
    const starter = await thread.fetchStarterMessage()
    service.attachThread(report.id, thread.id, starter.id)
    await thread.members.add(report.reporter_id)
    return thread
  }
  async function begin(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        ...safeMessage(
          'Open the report launcher in a server to file a report.'
        ),
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    await interaction.reply({
      ...safeMessage('What would you like to do?'),
      flags: MessageFlags.Ephemeral,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('report:category')
            .setPlaceholder('Choose one')
            .addOptions(
              choices.map(([value, label, description]) => ({
                value,
                label,
                description,
              }))
            )
        ),
      ],
    })
  }
  async function staff(interaction) {
    const member = await interaction.guild.members.fetch({
      user: interaction.user.id,
      force: true,
    })
    return member.roles.cache.has(ctx.config.staffRoleId)
  }
  async function launcher() {
    const channel = await client.channels.fetch(ctx.config.launcherChannelId)
    if (!channel?.isTextBased() || channel.guildId !== forum.guildId)
      throw new Error(
        'The launcher must be a text channel in the report forum server.'
      )
    const hasLauncher = (message) =>
      message.author.id === client.user.id &&
      message.components.some((component) =>
        component.components.some((item) => item.customId === 'report:start')
      )
    const saved = ctx.store.getCursor('reports:launcher')
    let existing
    if (saved?.cursor)
      existing = await channel.messages.fetch(saved.cursor).catch((err) => {
        if (err.code !== 10008) throw err
        return null
      })
    if (!existing || !hasLauncher(existing)) {
      let before
      while (true) {
        const messages = await channel.messages.fetch({
          limit: 100,
          ...(before ? { before } : {}),
        })
        existing = messages.find(hasLauncher)
        if (existing || messages.size < 100) break
        before = messages.last().id
      }
    }
    // Not safeMessage: suppressing embeds would hide this one. Editing also
    // clears the flag on a launcher posted as plain text.
    const payload = {
      content: '',
      flags: 0,
      allowedMentions: { parse: [] },
      embeds: [
        new EmbedBuilder()
          .setColor(0xe03131)
          .setTitle('Report a Bug')
          .setDescription(
            'Found a bug in Maintainerr? Use the button below to report it.'
          )
          .addFields(
            {
              name: 'What Happens Next',
              value:
                'Describe the bug and add screenshots or plain-text logs if you have them. A maintainer reviews every report before it goes to GitHub.',
            },
            {
              name: 'Before You Submit',
              value: `Reports, replies and attached files are public in <#${forum.id}> and on GitHub. Do not include passwords or API keys.`,
            },
            {
              name: 'Not a Bug?',
              value: `Suggest features at ${FEATURES_URL}. For help with your setup, ask in ${supportChannels(ctx.config) || 'the support forums'}.`,
            }
          ),
      ],
      components: [
        row(button('report:start', 'Report a Bug', ButtonStyle.Primary)),
      ],
    }
    const message = existing
      ? await existing.edit(payload)
      : await channel.send(payload)
    ctx.store.setCursor('reports:launcher', message.id)
  }

  return {
    ...service,
    update,
    async ready() {
      forum = await client.channels.fetch(ctx.config.forumChannelId)
      if (forum?.type !== ChannelType.GuildForum)
        throw new Error(
          'DISCORD_FORUM_CHANNEL_ID must identify a forum channel.'
        )
      await launcher()
      for (const report of service.pending()) {
        if (ctx.store.getCursor(`discord:deleted-thread:${report.thread_id}`))
          continue
        try {
          await ensureThread(report)
          await update(service.get(report.id))
        } catch (err) {
          if (![10003, 50001, 50013].includes(err.code)) throw err
          if (err.code === 10003)
            ctx.store.setCursor(
              `discord:deleted-thread:${report.thread_id}`,
              'true'
            )
          ctx.logger.debug(
            `Report ${report.id} could not restore its thread:`,
            describeError(err)
          )
        }
      }
    },
    async interaction(interaction) {
      if (!interaction.customId?.startsWith('report:')) return
      try {
        const [prefix, action, id] = interaction.customId.split(':')
        if (prefix !== 'report') return
        if (action === 'start') {
          await begin(interaction)
          return
        }
        if (action === 'bug') {
          await interaction.showModal(reportModal())
          return
        }
        if (action === 'category' && interaction.isStringSelectMenu()) {
          const choice = interaction.values[0]
          if (choice === 'bug') {
            await interaction.showModal(reportModal())
            return
          }
          if (!redirects[choice])
            throw new ReportError('Choose a valid option.')
          await interaction.update({
            ...safeMessage(redirects[choice](ctx.config)),
            components: [],
          })
          return
        }
        const report = action === 'create' ? null : service.get(id)
        if (
          action !== 'create' &&
          (!report || report.guild_id !== interaction.guildId)
        )
          throw new ReportError('Report not found in this server.')
        if (action === 'edit') {
          if (report.reporter_id !== interaction.user.id)
            throw new ReportError('Only the reporter can edit this report.')
          await interaction.showModal(reportModal(report))
          return
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        if (action === 'create' && interaction.isModalSubmit()) {
          if (!forum || interaction.guildId !== forum.guildId)
            throw new ReportError(
              'Use the report launcher in its configured server.'
            )
          const created = service.create({
            guildId: interaction.guildId,
            reporterId: interaction.user.id,
            category: id,
            fields: Object.fromEntries(
              Object.keys(fieldLabels).map((key) => [
                key,
                interaction.fields.getTextInputValue(key),
              ])
            ),
          })
          const thread = await ensureThread(created)
          await interaction.editReply(
            safeMessage(
              `Your report is open in <#${thread.id}>. Add images or text logs there, then choose Done or No Files.`
            )
          )
          return
        }
        let changed = report
        let content = 'Report updated.'
        if (action === 'done') {
          changed = service.finish(id, interaction.user.id)
          content = 'Your report is ready for a maintainer to review.'
        } else if (action === 'cancel')
          changed = service.cancel(id, interaction.user.id)
        else if (action === 'save' && interaction.isModalSubmit())
          changed = service.edit(
            id,
            interaction.user.id,
            Object.fromEntries(
              Object.keys(fieldLabels).map((key) => [
                key,
                interaction.fields.getTextInputValue(key),
              ])
            )
          )
        else if (action === 'staff') {
          if (!(await staff(interaction)))
            throw new ReportError(
              'Only the configured staff role can publish reports.'
            )
          await interaction.editReply({
            ...safeMessage('Review this report, then publish it to GitHub.'),
            components: ctx.config.githubEnabled
              ? [
                  row(
                    button(
                      `report:publish:${id}`,
                      'Publish to GitHub',
                      ButtonStyle.Danger
                    )
                  ),
                ]
              : [],
          })
          return
        } else if (action === 'publish') {
          changed = service.requestPublish(id, {
            staff: await staff(interaction),
            guildId: interaction.guildId,
          })
          content =
            'Publishing queued. The issue link will appear in the report thread.'
        } else throw new ReportError('This action is no longer available.')
        await update(changed)
        await interaction.editReply(safeMessage(content))
      } catch (err) {
        if (!(err instanceof ReportError)) {
          ctx.logger.warn('Report action failed. Check Discord permissions.')
          ctx.logger.debug(describeError(err))
        }
        const payload = safeMessage(
          err instanceof ReportError
            ? err.message
            : 'The report action failed. Please try again in a moment.'
        )
        if (interaction.deferred || interaction.replied)
          await interaction.editReply(payload)
        else
          await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
      }
    },
    async message(message) {
      if (message.author.bot) return
      const report = service.byThread(message.channelId)
      if (!report) return
      if (report.state === 'published') {
        service.queueReply(report, message)
        return
      }
      if (
        report.state !== 'collecting' ||
        report.reporter_id !== message.author.id
      )
        return
      try {
        for (const attachment of message.attachments.values()) {
          const { kind, type, bytes } = await downloadAttachment(
            attachment,
            ctx.config.attachmentMaxBytes
          )
          service.addAttachment(report.id, message.author.id, {
            discordId: attachment.id,
            filename: attachment.name,
            type,
            size: bytes.length,
            url: message.url,
            content: kind === 'text' ? bytes.toString('utf8') : null,
          })
        }
        if (message.content.trim())
          service.addAttachment(report.id, message.author.id, {
            discordId: message.id,
            filename: 'pasted-log.txt',
            type: 'text/plain',
            size: Buffer.byteLength(message.content),
            content: message.content,
            url: message.url,
          })
        await message.reply(
          safeMessage(
            'Saved to the report. Choose Done when you have finished adding files.'
          )
        )
      } catch (err) {
        await message.reply(safeMessage(err.message))
      }
    },
  }
}
