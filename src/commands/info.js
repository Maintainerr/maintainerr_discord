import { SlashCommandBuilder } from 'discord.js'
import { handleDelete, handleHelp } from '../capabilities/info/handlers.js'

const command = (name, description, handler) => ({
  data: new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .toJSON(),
  handlers: new Map([['', handler]]),
})

export const commands = [
  command(
    'help',
    'Show what the bot can do, with links to the documentation.',
    handleHelp
  ),
  command(
    'delete',
    'Learn when Maintainerr takes action on your media.',
    handleDelete
  ),
]
