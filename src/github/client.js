import { createPrivateKey, sign } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

export function appJwt(appId, privateKey, now = Date.now()) {
  const issued = Math.floor(now / 1000) - 60
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: issued, exp: issued + 600, iss: String(appId) })}`
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`
}

export class GitHubError extends Error {
  constructor(status, retryAt) {
    super(`GitHub returned HTTP ${status}.`)
    this.status = status
    this.retryAt = retryAt
  }
}

export function createGitHub(
  config,
  { fetchFn = fetch, now = Date.now, wait = sleep } = {}
) {
  const key = createPrivateKey(config.githubPrivateKey)
  let cached
  let exchanging
  let tail = Promise.resolve()
  let lastMutation = -Infinity
  const root = `/repos/${config.githubRepository}`
  async function token() {
    if (cached && cached.expires > now() + 60000) return cached.value
    if (!exchanging)
      exchanging = (async () => {
        const response = await fetchFn(
          `https://api.github.com/app/installations/${config.githubInstallationId}/access_tokens`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            headers: {
              Authorization: `Bearer ${appJwt(config.githubAppId, key, now())}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'maintainerr-discord',
            },
          }
        )
        if (!response.ok) throw new GitHubError(response.status)
        const data = await response.json()
        if (
          typeof data.token !== 'string' ||
          !Number.isFinite(Date.parse(data.expires_at))
        )
          throw new Error('GitHub returned an invalid installation token.')
        cached = { value: data.token, expires: Date.parse(data.expires_at) }
        return cached.value
      })().finally(() => {
        exchanging = null
      })
    return exchanging
  }
  const client = {
    root,
    request(method, path, body, { etag } = {}) {
      if (!path.startsWith('/') || path.startsWith('//'))
        return Promise.reject(new Error('Invalid GitHub API path.'))
      const result = tail.then(async () => {
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          const delay = lastMutation + 1000 - now()
          if (delay > 0) await wait(delay)
          lastMutation = now()
        }
        const response = await fetchFn(`https://api.github.com${path}`, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${await token()}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'maintainerr-discord',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        if (response.status === 304)
          return {
            status: 304,
            etag: response.headers.get('etag') || etag,
            data: null,
          }
        if (!response.ok) {
          if (response.status === 401) cached = null
          const retryAfter = response.headers.get('retry-after')
          const seconds = Number(retryAfter)
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
          const retryAt = seconds
            ? now() + seconds * 1000
            : Date.parse(retryAfter) || reset || now() + 60000
          await response.body?.cancel()
          throw new GitHubError(response.status, retryAt)
        }
        const link = response.headers
          .get('link')
          ?.match(/<([^>]+)>; rel="next"/)
        let next
        if (link) {
          const url = new URL(link[1])
          if (url.origin !== 'https://api.github.com')
            throw new Error('Untrusted GitHub pagination origin.')
          next = url.pathname + url.search
        }
        return {
          status: response.status,
          data: response.status === 204 ? null : await response.json(),
          etag: response.headers.get('etag'),
          next,
        }
      })
      tail = result.catch(() => {})
      return result
    },
    async list(path) {
      const items = []
      for (let page = 0; path && page < 100; page += 1) {
        const response = await client.request('GET', path)
        if (!Array.isArray(response.data))
          throw new Error('GitHub returned an invalid list.')
        items.push(...response.data)
        path = response.next
      }
      if (path) throw new Error('GitHub pagination exceeded the page limit.')
      return items
    },
    async ensureLabels() {
      for (const [name, color] of [
        ['source:discord', '5865F2'],
        ['bug', 'd73a4a'],
        ['enhancement', 'a2eeef'],
        ['question', 'd876e3'],
      ]) {
        try {
          await client.request(
            'GET',
            `${root}/labels/${encodeURIComponent(name)}`
          )
        } catch (err) {
          if (err.status !== 404) throw err
          try {
            await client.request('POST', `${root}/labels`, { name, color })
          } catch (createError) {
            if (createError.status !== 422) throw createError
            await client.request(
              'GET',
              `${root}/labels/${encodeURIComponent(name)}`
            )
          }
        }
      }
    },
  }
  return client
}
