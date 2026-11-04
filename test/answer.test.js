import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/db.js'
import {
  chunkDocument,
  createDocsIndex,
} from '../src/capabilities/support/docs.js'
import { createAnswerer } from '../src/capabilities/support/answer.js'

test('without a provider answering returns the three closest doc links', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const docs = createDocsIndex(store)
  docs.replace(
    chunkDocument(
      '# Rules\n## Plex connection\nPlex connection URL\n## Radarr connection\nRadarr connection URL\n## Sonarr connection\nSonarr connection URL',
      'docs/Rules.mdx'
    )
  )
  const answer = createAnswerer({ docs, logger: { debug() {} } })
  const text = await answer('How do I set a connection URL?')
  assert.equal((text.match(/https:\/\//g) ?? []).length, 3)
  assert.match(text, /support bot/i)
  // Two chunks of one section are linked once.
  const section = { page: 'Configuration', heading: 'Plex', content: '' }
  const repeated = createAnswerer({
    docs: {
      search: () => [
        { ...section, url: 'https://docs.example.test/configuration/#plex' },
        { ...section, url: 'https://docs.example.test/configuration/#plex' },
      ],
    },
    logger: { debug() {} },
  })
  assert.equal(
    ((await repeated('Plex connection failed')).match(/https:\/\//g) ?? [])
      .length,
    1
  )
})

test('provider failure or an ungrounded citation falls back to doc links', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const docs = createDocsIndex(store)
  docs.replace(
    chunkDocument(
      '# Rules\n## Connections\nPlex connection URL',
      'docs/Rules.mdx'
    )
  )
  for (const complete of [
    async () => {
      throw new Error('quota reached')
    },
    async () => 'Use https://untrusted.invalid/setting',
  ]) {
    const answer = createAnswerer({
      docs,
      provider: { complete },
      logger: { debug() {} },
    })
    assert.match(
      await answer('Plex connection'),
      /closest documentation sections/
    )
    assert.doesNotMatch(await answer('Plex connection'), /untrusted.invalid/)
  }
})

test('answer formatting preserves legacy citation URLs and validates the truncated body', async () => {
  const url = 'https://docs.example.test/overseerr/'
  const docs = {
    search: () => [
      {
        page: 'Overseerr',
        heading: 'Connection',
        url,
        content: 'Use a connection URL.',
      },
    ],
  }
  const logger = { debug() {} }
  for (const response of [
    null,
    `Overseerr connection. [Overseerr docs](${url})`,
    `${'Documented advice. '.repeat(110)}\nSource: ${url}`,
    `${'x'.repeat(1790)} ${url}`,
  ]) {
    const answer = createAnswerer({
      docs,
      logger,
      provider: response === null ? null : { complete: async () => response },
    })
    const text = await answer('How do connections work?')
    assert.ok(text.includes(url), response)
    assert.doesNotMatch(text, /\/Seerr\//)
    assert.match(text, /Seerr/)
    assert.ok(text.length <= 1828)
    if (response?.startsWith('Documented') || response?.startsWith('xxx'))
      assert.match(text, /closest documentation sections/)
  }
})
