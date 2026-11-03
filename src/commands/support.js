import { SlashCommandBuilder } from 'discord.js'
import { handleAsk } from '../capabilities/support/handlers.js'

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ask')
      .setDescription('Find an answer in the Maintainerr documentation.')
      .addStringOption((option) =>
        option
          .setName('question')
          .setDescription('What do you need help with?')
          .setRequired(true)
          .setMaxLength(2000)
      )
      .toJSON(),
    handlers: new Map([['', handleAsk]]),
  },
]
