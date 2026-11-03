export const reportMarker = (id) => `<!-- maintainerr-discord:report:${id} -->`
export const commentMarker = (id) =>
  `<!-- maintainerr-discord:message:${id} -->`
export const discordMarker = (id) => `-# maintainerr-discord:${id}`
export const hasMarker = (body = '') =>
  /(?:<!--\s*maintainerr-discord:|(?:^|\n)-# maintainerr-discord:)/.test(body)
export const ownsMarker = (item, marker) =>
  item.user?.type === 'Bot' && item.body?.split('\n')[0] === marker
