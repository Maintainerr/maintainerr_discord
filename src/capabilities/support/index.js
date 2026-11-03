import { MessageFlags } from 'discord.js'
import { commands } from '../../commands/support.js'
import { feedbackRow, reserveQuestion } from './handlers.js'
import { safeMessage } from '../../lib/http.js'
import { isTestMediaText } from '../testmedia/decoder.js'
import { allowsScreenshot, inSupportChannel } from '../testmedia/scope.js'

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
      const question =
        ctx.config.supportChannelIds.includes(message.channelId) ||
        (message.id === message.channelId &&
          inSupportChannel(message, ctx.config))
      if (
        message.author.bot ||
        !question ||
        !message.content.trim() ||
        isTestMediaText(message.content)
      )
        return
      if (!reserveQuestion(ctx, message.author.id, message.id)) return
      await message.reply({
        ...safeMessage(await ctx.answer(message.content)),
        components: [feedbackRow()],
      })
    })
    client.on('interactionCreate', async (interaction) => {
      if (
        !interaction.isButton() ||
        interaction.customId !== 'support:unhelpful'
      )
        return
      if (ctx.reports) await ctx.reports.begin(interaction)
      else
        await interaction.reply({
          ...safeMessage(
            'Please ask a maintainer in the support channel. Report intake is currently disabled.'
          ),
          flags: MessageFlags.Ephemeral,
        })
    })
  },
}
