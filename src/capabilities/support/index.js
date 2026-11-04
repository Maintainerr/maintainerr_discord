import { MessageFlags } from 'discord.js'
import { commands } from '../../commands/support.js'
import { escalate, feedbackRow, reserveQuestion } from './handlers.js'
import { bugReportRow } from '../reports/discord.js'
import { safeMessage } from '../../lib/http.js'
import { findPaste } from '../testmedia/decoder.js'
import { where } from '../../lib/logging.js'
import { allowsScreenshot, inSupportChannel } from '../testmedia/scope.js'

// Channel pastes are decoded only with the smart decoder.
const TIP = '\n-# Tip: paste your Test Media output here to have it explained.'

export default {
  name: 'support',
  enabled: (config) => config.featureSupport,
  commands,
  register(client, ctx) {
    client.on('messageCreate', async (message) => {
      if (ctx.reports?.byThread(message.channelId)) return
      if (
        allowsScreenshot(message, ctx.config, client.user?.id) &&
        message.attachments.some((attachment) =>
          attachment.contentType?.startsWith('image/')
        )
      )
        return
      // A forum post's opening message shares the thread's id, so this answers
      // each post once instead of every reply in its thread.
      const opening = message.id === message.channelId
      const asked =
        ctx.config.supportChannelIds.includes(message.channelId) ||
        (opening && inSupportChannel(message, ctx.config))
      // People often put the whole question in a forum post's title.
      const question = [opening && message.channel?.name, message.content]
        .filter(Boolean)
        .join('\n')
        .trim()
      if (message.author.bot || !asked || !question) return
      if (await findPaste(message, ctx)) return
      if (!reserveQuestion(ctx, message.author.id, message.id)) {
        ctx.logger.debug(
          `[answer] skipped ${message.author.tag} in ${where(message)}: cooldown or already answered`
        )
        return
      }
      await message.reply({
        ...safeMessage(
          `${await ctx.answer(question)}${ctx.config.featureSmartDecoder ? TIP : ''}`
        ),
        components: [feedbackRow()],
      })
      ctx.logger.debug(`[answer] ${message.author.tag} in ${where(message)}`)
    })
    client.on('interactionCreate', async (interaction) => {
      if (
        !interaction.isButton() ||
        interaction.customId !== 'support:unhelpful'
      )
        return
      ctx.logger.debug(
        `[unhelpful] ${interaction.user.tag} in ${where(interaction)}`
      )
      // Deferred so the reply can say whether the ping went through.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const lines = [
        (await escalate(interaction, ctx))
          ? 'Thanks for letting us know. A maintainer has been notified and will take a look here, so add any details that might help.'
          : 'Thanks for letting us know. Add more details here and a maintainer will take a look.',
      ]
      if (ctx.config.featureReports)
        lines.push('If you think you found a bug, you can report it.')
      await interaction.editReply({
        ...safeMessage(lines.join('\n')),
        components: ctx.config.featureReports ? [bugReportRow()] : [],
      })
    })
  },
}
