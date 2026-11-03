import { SlashCommandBuilder } from 'discord.js'
import { handleRoles } from '../capabilities/roles/handlers.js'

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('roles')
      .setDescription('Choose which announcement roles you have.')
      .toJSON(),
    handlers: new Map([['', handleRoles]]),
  },
]
