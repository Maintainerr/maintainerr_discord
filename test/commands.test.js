import test from 'node:test'
import assert from 'node:assert/strict'
import capabilities from '../src/capabilities/index.js'
import testmedia from '../src/capabilities/testmedia/index.js'
import info from '../src/capabilities/info/index.js'
import { createCommandRegistry } from '../src/commands/index.js'

test('registration removes retired commands in both scopes and leaves unmanaged ones alone', async () => {
  const deleted = []
  const created = []
  const manager = (scope) => ({
    fetch: async () => [
      { id: `${scope}-old`, name: 'maintainerr' },
      { id: `${scope}-theirs`, name: 'unrelated-tool' },
    ],
    create: async (command) => created.push(`${scope} ${command.name}`),
    edit: async () => {},
    delete: async (id) => deleted.push(id),
  })
  const registry = createCommandRegistry(
    [testmedia],
    { config: { discordGuildId: 'guild' }, logger: { debug() {} } },
    capabilities
  )
  await registry.register({
    application: { commands: manager('global') },
    guilds: {
      fetch: async () => ({
        id: 'guild',
        name: 'Guild',
        commands: manager('guild'),
      }),
    },
  })
  assert.deepEqual(created, ['guild testmedia'])
  assert.deepEqual(deleted, ['guild-old', 'global-old'])
})

test('/help lists exactly the registered commands', async () => {
  const ctx = {
    config: { supportChannelIds: [], docsOrigin: 'https://docs.example' },
    logger: { debug() {} },
  }
  let reply
  await createCommandRegistry([testmedia, info], ctx, capabilities).dispatch({
    isChatInputCommand: () => true,
    commandName: 'help',
    options: { getSubcommand: () => null },
    user: { tag: 'member' },
    guildId: null,
    reply: async (message) => (reply = message),
  })
  assert.deepEqual(
    reply.content
      .split('\n')
      .filter((line) => line.startsWith('- `/'))
      .map((line) => line.slice(3, line.indexOf('`', 3))),
    ['/delete', '/help', '/testmedia']
  )
})
