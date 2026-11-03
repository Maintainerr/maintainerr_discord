export async function readLimited(response, limit) {
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > limit)
        throw new Error(`Response exceeds the ${limit} byte limit.`)
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

export function safeMessage(text) {
  return { content: text, allowedMentions: { parse: [] } }
}

// RFC 9110 allows Retry-After as either delay-seconds or an HTTP-date. Both the
// GitHub client and the model provider answer 429s, so they read it the same way
// here rather than drifting apart in two hand-rolled copies.
export function retryAfterMs(headers, now) {
  const value = headers.get('retry-after')
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}
