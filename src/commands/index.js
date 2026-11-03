async function upsertCommands(commandManager, commands, managedNames) {
  const existing = await commandManager.fetch()

  for (const command of commands) {
    const current = existing.find((item) => item.name === command.name)
    if (current) {
      await commandManager.edit(current.id, command)
    } else {
      await commandManager.create(command)
    }
  }
  for (const command of existing.values()) {
    if (
      managedNames.has(command.name) &&
      !commands.some((item) => item.name === command.name)
    )
      await commandManager.delete(command.id)
  }
}

// Commands this bot used to register. Only managed names are ever deleted, and
// nothing defines these any more, so list them or they linger as dead commands.
const RETIRED = ['maintainerr', 'unraid']

export function createCommandRegistry(
  capabilities,
  ctx,
  allCapabilities = capabilities
) {
  const commands = new Map()
  const managedNames = new Set([
    ...RETIRED,
    ...allCapabilities.flatMap((capability) =>
      capability.commands.map((command) => command.data.name)
    ),
  ])

  for (const capability of capabilities) {
    for (const command of capability.commands) {
      if (commands.has(command.data.name)) {
        throw new Error(`Duplicate command: ${command.data.name}`)
      }
      commands.set(command.data.name, command)
    }
  }
  const definitions = [...commands.values()].map((command) => command.data)
  // /help lists exactly what is registered.
  ctx.commands = definitions

  return {
    async register(client) {
      if (!client.application) return

      if (ctx.config.discordGuildId) {
        const guild = await client.guilds.fetch(ctx.config.discordGuildId)
        await upsertCommands(guild.commands, definitions, managedNames)
        ctx.logger.debug(
          `Registered slash commands in guild ${guild.name} (${guild.id}).`
        )
        // Global copies from an earlier global registration would linger.
        await upsertCommands(client.application.commands, [], managedNames)
        return
      }

      await upsertCommands(
        client.application.commands,
        definitions,
        managedNames
      )
      ctx.logger.debug('Registered global slash commands.')
    },

    async dispatch(interaction) {
      if (!interaction.isChatInputCommand()) return

      const command = commands.get(interaction.commandName)
      if (!command) return

      const subcommand = interaction.options.getSubcommand(false) ?? ''
      const handler = command.handlers.get(subcommand)
      if (handler) await handler(interaction, ctx)
    },
  }
}
