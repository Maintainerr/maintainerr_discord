import { GatewayIntentBits } from 'discord.js'
import { safeMessage } from '../../lib/http.js'
import { describeError } from '../../lib/logging.js'

export const GUIDE_URL =
  'https://github.com/Maintainerr/maintainerr_discord#using-it'

export function supportLines(config) {
  if (!config.supportChannelIds.length) return []
  const help = config.supportChannelIds.map((id) => `<#${id}>`).join(' or ')
  return [
    `- Ask for help in ${help}. Search there first, since your question may already be answered.`,
    '- Paste your Test Media output in a post to have it explained.',
  ]
}

export function welcomeText(member, config) {
  const lines = [`Welcome to Maintainerr, <@${member.id}>!`, '']
  if (member.guild.rulesChannelId)
    lines.push(`- Start with <#${member.guild.rulesChannelId}>.`)
  lines.push(
    ...supportLines(config),
    '- `/ask` searches the documentation from any channel, and `/testmedia` explains a Test Media result privately in a DM.',
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
    client.on('guildMemberAdd', async (member) => {
      if (member.user.bot) return
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
