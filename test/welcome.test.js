import test from 'node:test'
import assert from 'node:assert/strict'
import { GatewayIntentBits } from 'discord.js'
import { gatewayIntents } from '../src/capabilities/index.js'
import welcome, {
  GUIDE_URL,
  welcomeText,
} from '../src/capabilities/welcome/index.js'

test('the privileged member intent is requested only while welcome is on', () => {
  const members = GatewayIntentBits.GuildMembers
  assert.ok(!gatewayIntents({ featureWelcome: false }).includes(members))
  assert.ok(gatewayIntents({ featureWelcome: true }).includes(members))
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
        featureSupport: true,
        featureSmartDecoder: true,
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
    assert.ok(sent[0].content.includes(part), part) // Without support or the decoder, neither /ask nor paste decoding is offered.
  const plain = welcomeText(member('newcomer', 'guild'), {
    supportChannelIds: ['support'],
  })
  assert.doesNotMatch(plain, /\/ask|Paste your Test Media/)
})

test('new members get the welcome role once they have accepted the rules', async () => {
  const handlers = {}
  const granted = []
  welcome.register(
    {
      on: (event, fn) => (handlers[event] = fn),
      channels: {
        fetch: async () => ({ guildId: 'guild', send: async () => {} }),
      },
    },
    {
      config: {
        welcomeChannelId: 'welcome',
        welcomeRoleId: 'member-role',
        supportChannelIds: [],
      },
      logger: { debug() {}, warn() {} },
    }
  )
  const member = (
    id,
    { pending = false, bot = false, guild = 'guild' } = {}
  ) => ({
    id,
    pending,
    user: { bot, tag: id },
    guild: {
      id: guild,
      roles: {
        cache: new Map(
          guild === 'guild'
            ? [['member-role', { id: 'member-role', name: 'everyone' }]]
            : []
        ),
      },
    },
    roles: { add: async (role) => granted.push(`${id} ${role?.id}`) },
  })
  await handlers.guildMemberAdd(member('ready'))
  await handlers.guildMemberAdd(member('screening', { pending: true }))
  await handlers.guildMemberAdd(member('helper-bot', { bot: true }))
  await handlers.guildMemberAdd(member('stranger', { guild: 'other-guild' }))
  await handlers.guildMemberUpdate(
    member('screening', { pending: true }),
    member('screening')
  )
  // Any later update, such as after a moderator removed the role, is ignored.
  await handlers.guildMemberUpdate(member('ready'), member('ready'))
  assert.deepEqual(granted, ['ready member-role', 'screening member-role'])
})
