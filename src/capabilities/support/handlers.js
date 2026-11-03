import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js'
import { safeMessage } from '../../lib/http.js'

export function feedbackRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('support:unhelpful')
      .setLabel('This Did Not Help')
      .setStyle(ButtonStyle.Secondary)
  )
}

export function reserveQuestion(ctx, userId, questionId, now = Date.now()) {
  return ctx.store.transaction(() => {
    const previous = ctx.store.getCursor(`support:user:${userId}`)
    if (previous && previous.updated_at > now - 30000) return false
    if (ctx.store.getCursor(`support:question:${questionId}`)) return false
    ctx.store.setCursor(`support:user:${userId}`, '', null, now)
    ctx.store.setCursor(`support:question:${questionId}`, '', null, now)
    return true
  })
}

export async function handleAsk(interaction, ctx) {
  ctx.logger.debug(
    `[ask] ${interaction.user.tag} in ${interaction.guild ? `#${interaction.channel?.name}` : 'DM'}`
  )
  if (!reserveQuestion(ctx, interaction.user.id, interaction.id)) {
    await interaction.reply({
      ...safeMessage('Please wait 30 seconds between questions.'),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.deferReply()
  await interaction.editReply({
    ...safeMessage(
      await ctx.answer(interaction.options.getString('question', true))
    ),
    components: [feedbackRow()],
  })
}
