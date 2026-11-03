import { commands } from '../../commands/roles.js'
import { toggleRole } from './handlers.js'
import { describeError } from '../../lib/logging.js'

export default {
  name: 'roles',
  enabled: (config) => config.selfRoleIds.length > 0,
  commands,
  register(client, ctx) {
    client.on('interactionCreate', (interaction) =>
      toggleRole(interaction, ctx).catch((err) =>
        ctx.logger.debug('Role panel update failed:', describeError(err))
      )
    )
  },
}
