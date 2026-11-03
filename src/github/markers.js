export const reportMarker = (id) => `<!-- maintainerr-discord:report:${id} -->`
export const commentMarker = (id) =>
  `<!-- maintainerr-discord:message:${id} -->`
export const discordMarker = (id) => `-# maintainerr-discord:${id}`
export const hasMarker = (body = '') =>
  /(?:<!--\s*maintainerr-discord:|(?:^|\n)-# maintainerr-discord:)/.test(body)
// botId is learned from our first write. Until then any bot is accepted, which
// is what recovery after a crash before that first write depends on.
export const ownsMarker = (item, marker, botId = null) =>
  (botId ? item.user?.id === botId : item.user?.type === 'Bot') &&
  item.body?.split('\n')[0] === marker
