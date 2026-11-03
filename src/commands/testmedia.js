import { SlashCommandBuilder } from 'discord.js'
import { handleBotCommand } from '../capabilities/testmedia/decoder.js'

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('maintainerr')
      .setDescription('Maintainerr Discord tools.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('bot')
          .setDescription(
            'Open a DM session to decode Maintainerr Test Media results.'
          )
      )
      .toJSON(),
    handlers: new Map([['bot', handleBotCommand]]),
  },
]
