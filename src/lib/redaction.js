// Discord REST paths contain usable interaction tokens for 15 minutes.
export const redactTokens = (text) =>
  String(text).replace(
    /\/(interactions|webhooks)\/(\d{1,20})\/[^/?#\s]+/g,
    '/$1/$2/[redacted]'
  )
