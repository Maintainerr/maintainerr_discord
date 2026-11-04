import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js'
import { safeMessage } from '../../lib/http.js'
import { describeError } from '../../lib/logging.js'
import { inSupportChannel } from '../testmedia/scope.js'

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

// One ping per answer in a support channel, however often its button is
// pressed. A failed ping releases its reservation so a later click retries.
// Returns whether a maintainer has been told.
export async function escalate(interaction, ctx) {
  const role = ctx.config.supportRoleId
  if (!role || !inSupportChannel(interaction, ctx.config)) return false
  const key = `support:escalated:${interaction.message.id}`
  const reserved = ctx.store.transaction(() => {
    if (ctx.store.getCursor(key)) return false
    ctx.store.setCursor(key, '')
    return true
  })
  if (!reserved) return true
  try {
    await interaction.channel.send(
      safeMessage(
        `<@&${role}> The documentation answer did not help <@${interaction.user.id}> here.`,
        { roles: [role] }
      )
    )
    return true
  } catch (err) {
    ctx.store.deleteCursor(key)
    ctx.logger.warn(
      'Support ping failed. Check the bot can post in the support channels.'
    )
    ctx.logger.debug(describeError(err))
    return false
  }
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
