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
