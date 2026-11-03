import test from 'node:test'
import assert from 'node:assert/strict'
import { GatewayIntentBits } from 'discord.js'
import { gatewayIntents } from '../src/capabilities/index.js'
import welcome, { GUIDE_URL } from '../src/capabilities/welcome/index.js'

test('the privileged member intent is requested only while welcome is on', () => {
  const members = GatewayIntentBits.GuildMembers
  const off = { featureWelcome: false, selfRoleIds: [] }
  assert.ok(!gatewayIntents(off).includes(members))
  assert.ok(gatewayIntents({ ...off, featureWelcome: true }).includes(members))
})

test('a new member is greeted once, and only they are mentioned', async () => {
  const handlers = {}
  const sent = []
  welcome.register(
    {
      on: (event, fn) => (handlers[event] = fn),
      channels: {
        fetch: async () => ({
          guildId: 'guild',
          send: async (message) => sent.push(message),
        }),
      },
    },
    {
      config: {
        welcomeChannelId: 'welcome',
        supportChannelIds: ['support', 'rule-help'],
      },
      logger: { debug() {}, warn() {} },
    }
  )
  const member = (id, guild, bot = false) => ({
    id,
    user: { bot, tag: id },
    guild: { id: guild, rulesChannelId: 'rules' },
  })
  await handlers.guildMemberAdd(member('newcomer', 'guild'))
  await handlers.guildMemberAdd(member('helper-bot', 'guild', true))
  await handlers.guildMemberAdd(member('stranger', 'other-guild'))
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].allowedMentions, {
    parse: [],
    roles: [],
    users: ['newcomer'],
  })
  for (const part of [
    '<@newcomer>',
    '<#rules>',
    '<#support>',
    '<#rule-help>',
    '/ask',
    '/testmedia',
    '/help',
    GUIDE_URL,
  ])
    assert.ok(sent[0].content.includes(part), part)
})
