// A forum post is a thread with its own id, so match the forum through the
// thread's parent as well as the channel itself.
export const inSupportChannel = (message, config) =>
  config.supportChannelIds.some(
    (id) => id === message.channelId || id === message.channel?.parentId
  )

export function allowsScreenshot(message, config, botId) {
  if (!config.featureScreenshots || message.author.bot) return false
  return (
    message.guildId === null ||
    inSupportChannel(message, config) ||
    Boolean(botId && message.mentions?.users?.has(botId))
  )
}
