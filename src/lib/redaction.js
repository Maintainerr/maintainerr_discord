// Discord REST paths contain usable interaction tokens for 15 minutes.
export const redactTokens = (text) =>
  String(text).replace(
    /\/(interactions|webhooks)\/(\d{1,20})\/[^/?#\s]+/g,
    '/$1/$2/[redacted]'
  )

const secretSuffixes = [
  'api_key',
  'apikey',
  'token',
  'secret',
  'private_key',
  'password',
  'passwd',
  'authorization',
]
const normalizeKey = (key) => key.toLowerCase().replaceAll('-', '_')
const isSensitiveKey = (key, keys) => {
  const normalized = normalizeKey(key)
  // Service usernames help triage; login fields and names paired with passwords are credentials.
  return (
    secretSuffixes.some((suffix) => normalized.endsWith(suffix)) ||
    normalized === 'username' ||
    normalized.endsWith('qbittorrent_username') ||
    normalized.endsWith('qbittorrentusername') ||
    (normalized.endsWith('username') &&
      ['password', 'passwd'].some(
        (suffix) =>
          keys.has(suffix) ||
          keys.has(normalized.slice(0, -'username'.length) + suffix)
      ))
  )
}

function redactPrivateKeys(text) {
  const begin = '-----BEGIN '
  let offset = 0
  while (true) {
    const start = text.indexOf(begin, offset)
    if (start < 0) return text
    const headerEnd = text.indexOf('-----', start + begin.length)
    if (headerEnd < 0) return text
    const type = text.slice(start + begin.length, headerEnd)
    if (!type.endsWith('PRIVATE KEY')) {
      offset = headerEnd + 5
      continue
    }
    const marker = `-----END ${type}-----`
    const end = text.indexOf(marker, headerEnd + 5)
    const replacement = '[redacted private key]'
    text =
      text.slice(0, start) +
      replacement +
      (end < 0 ? '' : text.slice(end + marker.length))
    offset = start + replacement.length
  }
}

export function redactSecrets(value, depth = 0) {
  if (depth > 20) return '[redacted nested value]'
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'string')
        return JSON.stringify(redactSecrets(parsed, depth + 1))
      if (parsed && typeof parsed === 'object')
        return JSON.stringify(redactObject(parsed, depth + 1))
    } catch {
      /* Plain log lines are handled below. */
    }
  }
  let text = redactPrivateKeys(redactTokens(value))
  text = text.replace(
    /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/[^\s"'<>]+/gi,
    '[redacted]'
  )
  text = text.replace(
    /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s"'<>]+/gi,
    '[redacted database URL]'
  )
  text = text.replace(
    /((?<![A-Za-z0-9_-])[A-Za-z0-9_-]*Authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+)[^\s"',;<>]+/gi,
    '$1[redacted]'
  )
  // Match both structured logs and URL query strings without removing labels.
  const pairedUsernames = [
    ...text.matchAll(
      /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]*)(?:password|passwd)(?:\\+)?["']?\s*[:=]/gi
    ),
  ].map((match) =>
    match[1]
      ? normalizeKey(`${match[1]}username`).split('_').join('[_-]')
      : '[A-Za-z0-9_-]*username'
  )
  const key = `(?:${[
    '[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|private[_-]?key|password|passwd|authorization)',
    'username',
    '[A-Za-z0-9_-]*qbittorrent[_-]?username',
    ...new Set(pairedUsernames),
  ].join('|')})`
  const boundary = '(?<![A-Za-z0-9_-])'
  text = text.replace(
    new RegExp(
      String.raw`(${boundary}${key}(\\+["'])\s*[:=]\s*\2)([\s\S]*?)\2`,
      'gi'
    ),
    '$1[redacted]$2'
  )
  text = text.replace(
    new RegExp(
      String.raw`(${boundary}${key}["']?\s*[:=]\s*)(["'])((?:\\[\s\S]|(?!\2)[^\\])*)\2`,
      'gi'
    ),
    '$1$2[redacted]$2'
  )
  text = text.replace(
    new RegExp(
      `(${boundary}${key}["']?\\s*[:=]\\s*)(?!["'])([^\\s&"',;<>}\\]]+)`,
      'gi'
    ),
    '$1[redacted]'
  )
  text = text.replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@')
  text = text.replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1[redacted]')
  text = text.replace(
    /([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi,
    '$1[redacted]'
  )
  return text
}

export function redactObject(value, depth = 0) {
  if (depth > 20) return '[redacted nested value]'
  if (typeof value === 'string') return redactSecrets(value, depth + 1)
  if (Array.isArray(value))
    return value.map((entry) => redactObject(entry, depth + 1))
  if (value && typeof value === 'object') {
    const keys = new Set(Object.keys(value).map(normalizeKey))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveKey(key, keys)
          ? '[redacted]'
          : redactObject(entry, depth + 1),
      ])
    )
  }
  return value
}
