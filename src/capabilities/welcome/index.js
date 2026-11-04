import { GatewayIntentBits } from 'discord.js'
import { safeMessage } from '../../lib/http.js'
import { describeError } from '../../lib/logging.js'

export const GUIDE_URL =
  'https://github.com/Maintainerr/maintainerr_discord#using-it'

export const supportChannels = (config) =>
  config.supportChannelIds.map((id) => `<#${id}>`).join(' or ')

export function supportLines(config) {
  if (!config.supportChannelIds.length) return []
  return [
    `- Ask for help in ${supportChannels(config)}. Search there first, since your question may already be answered.`,
    ...(config.featureSmartDecoder
      ? ['- Paste your Test Media output in a post to have it explained.']
      : []),
  ]
}

export function welcomeText(member, config) {
  const lines = [`Welcome to Maintainerr, <@${member.id}>!`, '']
  if (member.guild.rulesChannelId)
    lines.push(`- Start with <#${member.guild.rulesChannelId}>.`)
  lines.push(
    ...supportLines(config),
    config.featureSupport
      ? '- `/ask` searches the documentation from any channel, and `/testmedia` explains a Test Media result privately in a DM.'
      : '- `/testmedia` explains a Test Media result privately in a DM.',
    '- `/help` lists everything the bot can do.',
    '',
    `How to use the bot: ${GUIDE_URL}`
  )
  return lines.join('\n')
}

export default {
  name: 'welcome',
  enabled: (config) => config.featureWelcome,
  commands: [],
  // Privileged: requested only while this capability is enabled.
  intents: [GatewayIntentBits.GuildMembers],
  register(client, ctx) {
    async function giveRole(member) {
      const role = member.guild.roles.cache.get(ctx.config.welcomeRoleId)
      if (!role) return
      try {
        await member.roles.add(role, 'Welcome role')
        ctx.logger.debug(`[welcome] ${member.user.tag} got ${role.name}`)
      } catch (err) {
        if (err.code === 50013)
          ctx.logger.warn(
            'Welcome role failed. Give the bot Manage Roles and move its role above the welcome role.'
          )
        ctx.logger.debug(describeError(err))
      }
    }
    // Pending members have not accepted the server rules yet, so the role
    // waits until they do.
    client.on('guildMemberUpdate', async (old, member) => {
      if (ctx.config.welcomeRoleId && old.pending && !member.pending)
        await giveRole(member)
    })
    client.on('guildMemberAdd', async (member) => {
      if (member.user.bot) return
      if (ctx.config.welcomeRoleId && !member.pending) await giveRole(member)
      try {
        const channel = await client.channels.fetch(ctx.config.welcomeChannelId)
        if (channel?.guildId !== member.guild.id) return
        await channel.send(
          safeMessage(welcomeText(member, ctx.config), { users: [member.id] })
        )
        ctx.logger.debug(`[welcome] ${member.user.tag}`)
      } catch (err) {
        ctx.logger.warn(
          'Welcome message failed. Check the bot can post in the welcome channel.'
        )
        ctx.logger.debug(describeError(err))
      }
    })
  },
}
