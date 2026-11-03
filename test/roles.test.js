import test from 'node:test'
import assert from 'node:assert/strict'
import { ButtonStyle } from 'discord.js'
import roles from '../src/capabilities/roles/index.js'

const ROLE = '111111111111111111'
const STAFF = '222222222222222222'

test('a role button changes only the configured roles', async () => {
  let listener
  roles.register(
    { on: (event, fn) => (listener = fn) },
    {
      config: { selfRoleIds: [ROLE] },
      logger: { debug() {}, warn() {} },
    }
  )
  const guildRoles = new Map(
    [ROLE, STAFF].map((id) => [id, { id, name: `Role ${id}` }])
  )
  const writes = []
  const member = (held) => ({
    roles: {
      cache: new Map(held.map((id) => [id, guildRoles.get(id)])),
      add: async (role) => {
        writes.push(`add ${role.id}`)
        return member([...held, role.id])
      },
      remove: async (role) => {
        writes.push(`remove ${role.id}`)
        return member(held.filter((id) => id !== role.id))
      },
    },
  })
  const panels = []
  const click = (id, held) =>
    listener({
      isButton: () => true,
      customId: `roles:${id}`,
      inCachedGuild: () => true,
      guild: { roles: { cache: guildRoles } },
      member: member(held),
      user: { tag: 'member' },
      reply: async () => {},
      deferUpdate: async () => {},
      editReply: async (message) => panels.push(message),
      followUp: async () => {},
    })
  // A forged button for a role that exists but is not configured.
  await click(STAFF, [])
  await click(ROLE, [])
  await click(ROLE, [ROLE])
  assert.deepEqual(writes, [`add ${ROLE}`, `remove ${ROLE}`])
  assert.deepEqual(
    panels.map((panel) =>
      panel.components.flatMap((row) =>
        row
          .toJSON()
          .components.map((button) => [button.custom_id, button.style])
      )
    ),
    [
      [[`roles:${ROLE}`, ButtonStyle.Success]],
      [[`roles:${ROLE}`, ButtonStyle.Secondary]],
    ]
  )
})
