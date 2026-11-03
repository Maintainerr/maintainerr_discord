import test from 'node:test'
import assert from 'node:assert/strict'
import capabilities from '../src/capabilities/index.js'
import testmedia from '../src/capabilities/testmedia/index.js'
import { createCommandRegistry } from '../src/commands/index.js'

test('registration removes a retired command and leaves unmanaged ones alone', async () => {
  const deleted = []
  const created = []
  const commands = {
    fetch: async () => [
      { id: 'old', name: 'maintainerr' },
      { id: 'theirs', name: 'unrelated-tool' },
    ],
    create: async (command) => created.push(command.name),
    edit: async () => {},
    delete: async (id) => deleted.push(id),
  }
  const registry = createCommandRegistry(
    [testmedia],
    { config: { discordGuildId: 'guild' }, logger: { debug() {} } },
    capabilities
  )
  await registry.register({
    application: {},
    guilds: { fetch: async () => ({ id: 'guild', name: 'Guild', commands }) },
  })
  assert.deepEqual(created, ['testmedia'])
  assert.deepEqual(deleted, ['old'])
})
