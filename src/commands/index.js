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

export function createCommandRegistry(
  capabilities,
  ctx,
  allCapabilities = capabilities
) {
  const commands = new Map()
  const managedNames = new Set(
    allCapabilities.flatMap((capability) =>
      capability.commands.map((command) => command.data.name)
    )
  )

  for (const capability of capabilities) {
    for (const command of capability.commands) {
      if (commands.has(command.data.name)) {
        throw new Error(`Duplicate command: ${command.data.name}`)
      }
      commands.set(command.data.name, command)
    }
  }

  return {
    async register(client) {
      if (!client.application) return

      const definitions = [...commands.values()].map((command) => command.data)
      if (ctx.config.discordGuildId) {
        const guild = await client.guilds.fetch(ctx.config.discordGuildId)
        await upsertCommands(guild.commands, definitions, managedNames)
        ctx.logger.debug(
          `Registered slash commands in guild ${guild.name} (${guild.id}).`
        )
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
