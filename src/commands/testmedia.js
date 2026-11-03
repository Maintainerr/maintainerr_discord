import { SlashCommandBuilder } from 'discord.js'
import { handleBotCommand } from '../capabilities/testmedia/decoder.js'

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('testmedia')
      .setDescription(
        'Explain a Maintainerr Test Media result in a private DM.'
      )
      .toJSON(),
    handlers: new Map([['', handleBotCommand]]),
  },
]
