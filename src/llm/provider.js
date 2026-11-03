import { setTimeout as sleep } from 'node:timers/promises'
import { redactSecrets } from '../lib/redaction.js'
import { readLimited, retryAfterMs } from '../lib/http.js'

export class RequestQueue {
  constructor({ rpm = 1, capacity = 1, now = Date.now, wait = sleep } = {}) {
    this.interval = 60000 / rpm
    this.capacity = capacity
    this.tokens = capacity
    this.updated = now()
    this.now = now
    this.wait = wait
    this.tail = Promise.resolve()
    this.until = 0
  }

  pauseUntil(timestamp) {
    this.until = Math.max(this.until, timestamp)
  }

  run(fn, { deadline = Infinity } = {}) {
    const result = this.tail.then(async () => {
      const refill = () => {
        const now = this.now()
        this.tokens = Math.min(
          this.capacity,
          this.tokens + (now - this.updated) / this.interval
        )
        this.updated = now
      }
      while (this.now() < this.until) {
        const delay = this.until - this.now()
        if (this.now() + delay > deadline)
          throw new Error('Model queue exceeded the response window.')
        await this.wait(delay)
      }
      refill()
      while (this.tokens < 1) {
        const delay = Math.ceil((1 - this.tokens) * this.interval)
        if (this.now() + delay > deadline)
          throw new Error('Model queue exceeded the response window.')
        await this.wait(delay)
        refill()
      }
      if (this.now() > deadline)
        throw new Error('Model queue exceeded the response window.')
      this.tokens -= 1
      return fn()
    })
    this.tail = result.catch(() => {})
    return result
  }
}

export function createProvider(
  config,
  store,
  { fetchFn = fetch, queue, wait = sleep, now = Date.now } = {}
) {
  if (!config.llmBaseUrl) return null
  const requests = queue ?? new RequestQueue({ rpm: config.llmRpm, wait, now })
  const base = config.llmBaseUrl.endsWith('/')
    ? config.llmBaseUrl.slice(0, -1)
    : config.llmBaseUrl
  const endpoint = base.endsWith('/chat/completions')
    ? base
    : `${base}${base.endsWith('/v1') ? '' : '/v1'}/chat/completions`
  return {
    vision: config.llmVision,
    async complete({ system, user, images = [] }) {
      const deadline = now() + 120000
      if (images.length && !config.llmVision)
        throw new Error('The configured provider does not support images.')
      if (!store.consumeDaily('llm:daily', config.llmDailyLimit, now()))
        throw new Error('Daily model quota reached.')
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let retryAt = 0
        const response = await requests.run(
          async () => {
            const content = images.length
              ? [
                  { type: 'text', text: redactSecrets(user) },
                  ...images.map((url) => ({
                    type: 'image_url',
                    image_url: { url },
                  })),
                ]
              : redactSecrets(user)
            const sent = await fetchFn(endpoint, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(30000),
              headers: {
                'Content-Type': 'application/json',
                ...(config.llmApiKey
                  ? { Authorization: `Bearer ${config.llmApiKey}` }
                  : {}),
              },
              body: JSON.stringify({
                model: config.llmModel,
                temperature: 0,
                max_tokens: 800,
                messages: [
                  { role: 'system', content: redactSecrets(system) },
                  { role: 'user', content },
                ],
              }),
            })
            // Set the shared cooldown before another queued request can start.
            if (sent.status === 429) {
              retryAt =
                now() +
                Math.max(
                  1000,
                  retryAfterMs(sent.headers, now()) ?? 1000 * 2 ** attempt
                )
              requests.pauseUntil?.(retryAt)
            }
            return sent
          },
          { deadline }
        )
        if (response.status === 429 && attempt < 3) {
          await response.body?.cancel()
          if (retryAt > deadline)
            throw new Error(
              'Model provider is rate limited beyond the response window.'
            )
          await wait(Math.max(0, retryAt - now()))
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`Model provider returned HTTP ${response.status}.`)
        }
        const data = JSON.parse(
          (await readLimited(response, 2 * 1024 * 1024)).toString('utf8')
        )
        const text = data.choices?.[0]?.message?.content
        if (typeof text !== 'string' || !text.trim())
          throw new Error('Model provider returned no text.')
        return redactSecrets(text)
      }
    },
  }
}
