import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js'
import { safeMessage } from '../../lib/http.js'
import { describeError, where } from '../../lib/logging.js'

const PROMPT =
  'Select a role to add or remove it. Roles you have are green. They are only used for announcement mentions.'

function panel(guild, member, ids, note) {
  const buttons = ids
    .map((id) => guild.roles.cache.get(id))
    .filter(Boolean)
    .map((role) =>
      new ButtonBuilder()
        .setCustomId(`roles:${role.id}`)
        .setLabel(role.name.slice(0, 80))
        .setStyle(
          member.roles.cache.has(role.id)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
    )
  const components = []
  for (let start = 0; start < buttons.length; start += 5)
    components.push(
      new ActionRowBuilder().addComponents(buttons.slice(start, start + 5))
    )
  return {
    ...safeMessage(note ? `${note}\n${PROMPT}` : PROMPT),
    components,
  }
}

export async function handleRoles(interaction, ctx) {
  ctx.logger.debug(`[roles] ${interaction.user.tag} in ${where(interaction)}`)
  const message = interaction.inCachedGuild()
    ? panel(interaction.guild, interaction.member, ctx.config.selfRoleIds)
    : null
  await interaction.reply({
    ...(message?.components.length
      ? message
      : safeMessage('No roles can be chosen here.')),
    flags: MessageFlags.Ephemeral,
  })
}

export async function toggleRole(interaction, ctx) {
  if (!interaction.isButton() || !interaction.customId.startsWith('roles:'))
    return
  const id = interaction.customId.slice('roles:'.length)
  // Never trust the button: only configured roles may change.
  const role =
    ctx.config.selfRoleIds.includes(id) && interaction.inCachedGuild()
      ? interaction.guild.roles.cache.get(id)
      : null
  if (!role) {
    await interaction.reply({
      ...safeMessage('That role can no longer be chosen.'),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  await interaction.deferUpdate()
  const had = interaction.member.roles.cache.has(id)
  let member
  try {
    member = await (had
      ? interaction.member.roles.remove(role, 'Chosen with /roles')
      : interaction.member.roles.add(role, 'Chosen with /roles'))
  } catch (err) {
    if (err.code === 50013)
      ctx.logger.warn(
        'Role change failed. Give the bot Manage Roles and move its role above the roles in DISCORD_SELF_ROLE_IDS.'
      )
    ctx.logger.debug(describeError(err))
    await interaction.followUp({
      ...safeMessage(
        'That role could not be changed. Please tell a moderator.'
      ),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
  ctx.logger.debug(
    `[roles] ${interaction.user.tag} ${had ? 'removed' : 'added'} ${role.name}`
  )
  await interaction.editReply(
    panel(
      interaction.guild,
      member,
      ctx.config.selfRoleIds,
      `${had ? 'Removed' : 'Added'} ${escapeMarkdown(role.name)}.`
    )
  )
}
