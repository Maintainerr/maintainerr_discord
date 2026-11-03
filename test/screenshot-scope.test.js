import test from 'node:test'
import assert from 'node:assert/strict'
import { allowsScreenshot } from '../src/capabilities/testmedia/scope.js'

test('screenshots require a DM, configured support channel or explicit bot mention', () => {
  const config = { featureScreenshots: true, supportChannelId: 'support' }
  const base = {
    author: { bot: false },
    guildId: 'guild',
    channelId: 'general',
    mentions: { users: new Set() },
  }
  assert.equal(allowsScreenshot(base, config, 'bot'), false)
  assert.equal(
    allowsScreenshot({ ...base, content: 'Test Media meme' }, config, 'bot'),
    false
  )
  assert.equal(
    allowsScreenshot(
      { ...base, mentions: { everyone: true, users: new Set() } },
      config,
      'bot'
    ),
    false
  )
  assert.equal(
    allowsScreenshot(
      { ...base, mentions: { users: new Set(['other-user']) } },
      config,
      'bot'
    ),
    false
  )
  assert.equal(
    allowsScreenshot({ ...base, guildId: null }, config, 'bot'),
    true
  )
  assert.equal(
    allowsScreenshot({ ...base, channelId: 'support' }, config, 'bot'),
    true
  )
  assert.equal(
    allowsScreenshot(
      { ...base, mentions: { users: new Set(['bot']) } },
      config,
      'bot'
    ),
    true
  )
  assert.equal(
    allowsScreenshot(
      { ...base, guildId: null },
      { ...config, featureScreenshots: false },
      'bot'
    ),
    false
  )
})
