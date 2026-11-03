import test from 'node:test'
import assert from 'node:assert/strict'
import { ChannelType, MessageFlags } from 'discord.js'
import { allowsScreenshot } from '../src/capabilities/testmedia/scope.js'
import testmedia from '../src/capabilities/testmedia/index.js'
import support from '../src/capabilities/support/index.js'
import { openDatabase } from '../src/db.js'
import { payload, section, rule } from './helpers.js'

function capture(register, ctx) {
  const handlers = {}
  register(
    { user: { id: 'bot' }, on: (event, fn) => (handlers[event] = fn) },
    ctx
  )
  return handlers.messageCreate
}

test('screenshots require a DM, configured support channel or explicit bot mention', () => {
  const config = { featureScreenshots: true, supportChannelIds: ['support'] }
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
      { ...base, channelId: 'post', channel: { parentId: 'support' } },
      config,
      'bot'
    ),
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

test('channel pastes are decoded only in support channels and their forum posts', async () => {
  const content = JSON.stringify(
    payload([section([rule()])], { title: 'The Lantern Orchard' })
  )
  const onMessage = capture(testmedia.register, {
    config: {
      featureSmartDecoder: true,
      featureScreenshots: false,
      supportChannelIds: ['support'],
    },
    logger: { debug() {} },
  })
  const sent = []
  const paste = (channelId, parentId, thread) => ({
    content,
    channelId,
    author: { bot: false },
    channel: {
      type: thread ? ChannelType.PublicThread : ChannelType.GuildText,
      parentId,
      isThread: () => thread,
      send: async () => sent.push(channelId),
    },
    startThread: async () => ({ send: async () => sent.push(channelId) }),
  })
  await onMessage(paste('general', null, false))
  assert.deepEqual(sent, [], 'a paste outside support channels was decoded')
  await onMessage(paste('post', 'support', true))
  assert.ok(
    sent.includes('post'),
    'a paste in a support forum post was ignored'
  )
})

test('support answers each forum post once, using its title, and leaves pastes to the decoder', async (t) => {
  const store = openDatabase(':memory:')
  t.after(() => store.close())
  const asked = []
  const onMessage = capture(support.register, {
    config: { featureScreenshots: false, supportChannelIds: ['support'] },
    store,
    logger: { debug() {} },
    answer: async (question) => {
      asked.push(question)
      return 'An answer.'
    },
  })
  const answered = []
  // A separate author per message, so the per-user cooldown cannot hide a reply.
  const message = (id, channelId, parentId, author, content, name) => ({
    id,
    channelId,
    channel: { parentId, name },
    content,
    author: { id: author, bot: false, tag: author },
    attachments: [],
    reply: async (payload) => answered.push({ id, payload }),
  })
  const paste = JSON.stringify(payload([section([rule()])]))
  await onMessage(
    message(
      'post',
      'post',
      'support',
      'first',
      'help',
      'Why is my collection empty?'
    )
  )
  await onMessage(message('reply', 'post', 'support', 'second', 'More detail.'))
  await onMessage(
    message('elsewhere', 'elsewhere', 'other', 'third', 'A question?')
  )
  await onMessage(message('direct', 'support', null, 'fourth', 'A question?'))
  await onMessage(
    message(
      'pasted',
      'pasted',
      'support',
      'fifth',
      `My result:\n\n${paste}`,
      'Rule help'
    )
  )
  assert.deepEqual(
    answered.map((entry) => entry.id),
    ['post', 'direct']
  )
  assert.equal(asked[0], 'Why is my collection empty?\nhelp')
  assert.equal(answered[0].payload.flags, MessageFlags.SuppressEmbeds)
  assert.match(answered[0].payload.content, /Tip: paste your Test Media output/)
})
