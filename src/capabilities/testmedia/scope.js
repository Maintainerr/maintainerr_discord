export function allowsScreenshot(message, config, botId) {
  if (!config.featureScreenshots || message.author.bot) return false
  return (
    message.guildId === null ||
    Boolean(
      config.supportChannelId && message.channelId === config.supportChannelId
    ) ||
    Boolean(botId && message.mentions?.users?.has(botId))
  )
}
