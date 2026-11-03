import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db.js'
import {
  chunkDocument,
  createDocsIndex,
  refreshDocs,
} from '../src/capabilities/support/docs.js'

test('headings, explicit IDs, duplicate headings and fenced examples produce correct anchors', () => {
  const chunks = chunkDocument(
    '---\ntitle: Rules\nslug: /rules\n---\nIntro\n## Last watched\nfirst\n## Last watched\nsecond\n## Custom {#custom-id}\n```md\n## Example heading\n```\nText',
    'docs/Rules.mdx'
  )
  assert.deepEqual(
    chunks.map((chunk) => chunk.url),
    [
      'https://docs.maintainerr.info/rules/',
      'https://docs.maintainerr.info/rules/#last-watched',
      'https://docs.maintainerr.info/rules/#last-watched-1',
      'https://docs.maintainerr.info/rules/#custom-id',
    ]
  )
})

test('BM25 retrieves relevant sections and rule links change with source headings', (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const index = createDocsIndex(store)
  const source =
    '# Rules\nGeneral settings\n## Last watched\nsw_lastWatched tells when watched\n## Radarr\nRadarr connection settings'
  index.replace(chunkDocument(source, 'docs/Rules.mdx'))
  assert.match(index.search('Radarr connection')[0].url, /#radarr$/)
  assert.match(index.ruleLink('sw_lastWatched'), /#last-watched$/)
  index.replace(
    chunkDocument(source.replace('## Last watched\n', ''), 'docs/Rules.mdx')
  )
  assert.doesNotMatch(index.ruleLink('sw_lastWatched'), /#last-watched$/)
  assert.deepEqual(index.search('" OR * - :'), [])
})

test('failed corpus refresh preserves the previous persistent index', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const index = createDocsIndex(store)
  index.replace(
    chunkDocument('# Existing\nWorking connection settings', 'docs/Existing.md')
  )
  const fetchFn = async (url) =>
    url.includes('/git/trees/')
      ? Response.json({
          sha: 'fake-sha',
          tree: [{ type: 'blob', path: 'docs/Rules.mdx' }],
        })
      : new Response('unavailable', { status: 503 })
  await assert.rejects(
    refreshDocs(
      index,
      { docsRepository: 'fake/docs', docsRef: 'main' },
      fetchFn
    ),
    /503/
  )
  assert.equal(index.search('Working connection')[0].page, 'Existing')
})

test('frontmatter line parsing preserves quoted colons and CRLF input', () => {
  const chunks = chunkDocument(
    '---\r\ntitle: "Rules: Dates"\r\nslug: "/rules-dates"\r\n---\r\n## Dates\r\nA date value',
    'docs/Rules.mdx'
  )
  assert.equal(chunks[0].page, 'Rules: Dates')
  assert.equal(
    chunks[0].url,
    'https://docs.maintainerr.info/rules-dates/#dates'
  )
})

test('a persisted unchanged tree skips downloads after reboot and a changed sha reindexes', async (t) => {
  const path = mkdtempSync(join(tmpdir(), 'maintainerr-docs-'))
  let store = openDatabase(join(path, 'bot.sqlite'))
  t.after(() => {
    store.close()
    rmSync(path, { recursive: true })
  })
  const config = {
    docsRepository: 'Example/docs',
    docsRef: 'main',
    docsOrigin: 'https://docs.example.test',
  }
  let sha = 'fake-first-sha'
  let document = '# Rules\n## Last watched\nsw_lastWatched settings'
  const downloads = []
  const fetchFn = async (url) => {
    if (url.includes('/git/trees/'))
      return Response.json({
        sha,
        tree: [{ type: 'blob', path: 'docs/Rules.mdx' }],
      })
    downloads.push(url)
    return new Response(document)
  }
  let index = createDocsIndex(store)
  const count = await refreshDocs(index, config, fetchFn)
  assert.equal(downloads.length, 1)
  assert.ok(downloads[0].includes('/fake-first-sha/'))
  store.close()
  store = openDatabase(join(path, 'bot.sqlite'))
  index = createDocsIndex(store)
  assert.equal(await refreshDocs(index, config, fetchFn), count)
  assert.equal(downloads.length, 1)
  assert.match(index.ruleLink('sw_lastWatched'), /#last-watched$/)
  sha = 'fake-second-sha'
  document = '# Rules\n## Playback date\nsw_lastWatched revised guidance'
  await refreshDocs(index, config, fetchFn)
  assert.equal(downloads.length, 2)
  assert.ok(downloads[1].includes('/fake-second-sha/'))
  assert.equal(index.search('revised')[0].heading, 'Playback date')
  assert.equal(index.search('settings').length, 0)
  assert.match(index.ruleLink('sw_lastWatched'), /#playback-date$/)
})

test('API reference pages are not indexed, and changing that rule forces a reindex', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const config = {
    docsRepository: 'Example/docs',
    docsRef: 'main',
    docsOrigin: 'https://docs.example.test',
  }
  const downloads = []
  const fetchFn = async (url) => {
    if (url.includes('/git/trees/'))
      return Response.json({
        sha: 'fake-sha',
        tree: [
          { type: 'blob', path: 'docs/Rules.mdx' },
          { type: 'blob', path: 'docs/api/rules.md' },
          { type: 'blob', path: 'docs/API.md' },
        ],
      })
    downloads.push(url.split('/').at(-1))
    return new Response('# Rules\n## Matching\nhow rules match')
  }
  const index = createDocsIndex(store)
  // Built for the same docs commit before API pages were skipped.
  index.replace(
    [
      {
        page: 'Rules API',
        heading: 'Stale',
        content: 'stale integrator text',
        url: 'https://docs.example.test/api/rules/',
        source_path: 'docs/api/rules.md',
      },
    ],
    JSON.stringify({
      repository: config.docsRepository,
      ref: config.docsRef,
      origin: config.docsOrigin,
      sha: 'fake-sha',
    })
  )
  await refreshDocs(index, config, fetchFn)
  assert.deepEqual(downloads, ['Rules.mdx'])
  assert.equal(index.search('stale').length, 0)
})
