import { readLimited } from '../../lib/http.js'

const words = (value) =>
  String(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? []
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

export function chunkDocument(
  source,
  path,
  origin = 'https://docs.maintainerr.info'
) {
  let bodyLines = source.replaceAll('\r\n', '\n').split('\n')
  const metadata = {}
  const end = bodyLines[0] === '---' ? bodyLines.indexOf('---', 1) : -1
  if (end > 0) {
    for (const line of bodyLines.slice(1, end)) {
      const separator = line.indexOf(':')
      if (separator < 1) continue
      const key = line.slice(0, separator).trim()
      let value = line.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1)
      metadata[key] = value
    }
    bodyLines = bodyLines.slice(end + 1)
  }
  const page =
    metadata.title || path.replace(/^docs\//, '').replace(/\.mdx?$/, '')
  const route =
    metadata.slug ||
    `/${metadata.id || path.replace(/^docs\//, '').replace(/\.mdx?$/, '')}`
  const pageUrl = new URL(route.replace(/\/?$/, '/'), origin).href
  const chunks = []
  const seen = new Map()
  let heading = page
  let anchor = ''
  let lines = []
  let fence = null
  const flush = () => {
    const content = lines.join('\n').trim()
    for (let offset = 0; offset < content.length; offset += 2400) {
      chunks.push({
        page,
        heading,
        content: content.slice(offset, offset + 2400),
        url: pageUrl + anchor,
        source_path: path,
      })
    }
    lines = []
  }
  for (const line of bodyLines) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/)
    if (delimiter) {
      if (!fence) fence = delimiter[1][0]
      else if (fence === delimiter[1][0]) fence = null
    }
    const match = !fence && line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (match) {
      flush()
      const explicit = match[1].match(/\s*\{#([\w-]+)\}$/)
      heading = match[1].replace(/\s*\{#[\w-]+\}$/, '')
      const id = explicit?.[1] || slug(heading)
      const count = seen.get(id) ?? 0
      seen.set(id, count + 1)
      anchor = `#${id}${count ? `-${count}` : ''}`
    } else if (!/^import\s/.test(line)) lines.push(line)
  }
  flush()
  return chunks
}

export function buildRuleMap(chunks) {
  const rules = chunks.filter((chunk) =>
    /(?:^|\/)Rules\.mdx$/.test(chunk.source_path)
  )
  const normalize = (field) =>
    field
      .replace(/^(?:Plex|Jellyfin|Emby|Radarr|Sonarr|Seerr)\s*-\s*/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .trim()
  const map = new Map()
  for (const chunk of rules) {
    for (const label of [
      chunk.heading,
      ...[...chunk.content.matchAll(/^\|?\s*([^|\n]+)\s*\|/gm)].map(
        (match) => match[1]
      ),
      ...[...chunk.content.matchAll(/`([a-zA-Z][\w]+)`/g)].map(
        (match) => match[1]
      ),
    ]) {
      if (!map.has(normalize(label))) map.set(normalize(label), chunk.url)
    }
  }
  return (field) => {
    const key = normalize(field)
    if (map.has(key)) return map.get(key)
    const terms = words(key)
    let best = rules.find((chunk) => chunk.url.includes('#')) || rules[0]
    let bestScore = 0
    for (const chunk of rules) {
      const text = `${chunk.heading} ${chunk.content}`.toLowerCase()
      const score = terms.reduce(
        (sum, term) => sum + (text.includes(term) ? 1 : 0),
        0
      )
      if (score > bestScore) {
        best = chunk
        bestScore = score
      }
    }
    return best?.url
  }
}

export function createDocsIndex(store) {
  const { db } = store
  let ruleLink = buildRuleMap(
    db
      .prepare("SELECT * FROM doc_chunks WHERE source_path LIKE '%/Rules.mdx'")
      .all()
  )
  return {
    source: () => store.getCursor('docs:tree')?.cursor,
    replace(chunks, source = null) {
      store.transaction(() => {
        db.exec('DELETE FROM doc_chunks')
        const insert = db.prepare(
          'INSERT INTO doc_chunks (page, heading, content, url, source_path) VALUES (?, ?, ?, ?, ?)'
        )
        for (const chunk of chunks)
          insert.run(
            chunk.page,
            chunk.heading,
            chunk.content,
            chunk.url,
            chunk.source_path
          )
        store.setCursor('docs:tree', source)
      })
      ruleLink = buildRuleMap(chunks)
    },
    search(query, limit = 3) {
      const stop = new Set([
        'the',
        'a',
        'an',
        'is',
        'it',
        'to',
        'how',
        'do',
        'i',
        'and',
        'of',
        'my',
        'in',
        'for',
        'with',
        'can',
      ])
      const terms = [
        ...new Set(words(query).filter((word) => !stop.has(word))),
      ].slice(0, 20)
      if (!terms.length) return []
      return db
        .prepare(
          'SELECT *, bm25(doc_chunks) AS score FROM doc_chunks WHERE doc_chunks MATCH ? ORDER BY score LIMIT ?'
        )
        .all(terms.map((term) => `"${term}"`).join(' OR '), limit)
    },
    ruleLink(field) {
      return ruleLink(field)
    },
    count: () =>
      db.prepare('SELECT count(*) AS count FROM doc_chunks').get().count,
  }
}

export async function refreshDocs(index, config, fetchFn = fetch) {
  const response = await fetchFn(
    `https://api.github.com/repos/${config.docsRepository}/git/trees/${encodeURIComponent(config.docsRef)}?recursive=1`,
    {
      headers: {
        'User-Agent': 'maintainerr-discord',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    }
  )
  if (!response.ok)
    throw new Error(`Docs tree returned HTTP ${response.status}.`)
  const tree = await response.json()
  if (tree.truncated || !tree.sha || !Array.isArray(tree.tree))
    throw new Error('Docs tree is incomplete.')
  const files = tree.tree.filter(
    (entry) => entry.type === 'blob' && /^docs\/.*\.mdx?$/.test(entry.path)
  )
  if (!files.length) throw new Error('Docs tree contains no documentation.')
  const source = JSON.stringify({
    repository: config.docsRepository,
    ref: config.docsRef,
    origin: config.docsOrigin,
    sha: tree.sha,
  })
  if (index.source() === source && index.count()) return index.count()
  const chunks = []
  for (const file of files) {
    const document = await fetchFn(
      `https://raw.githubusercontent.com/${config.docsRepository}/${tree.sha}/${file.path}`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!document.ok)
      throw new Error(`Docs file returned HTTP ${document.status}.`)
    chunks.push(
      ...chunkDocument(
        (await readLimited(document, 2 * 1024 * 1024)).toString('utf8'),
        file.path,
        config.docsOrigin
      )
    )
  }
  if (!chunks.length) throw new Error('Docs index would be empty.')
  index.replace(chunks, source)
  return chunks.length
}
