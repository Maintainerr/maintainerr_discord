import { ChannelType } from 'discord.js'
import { commands } from '../../commands/testmedia.js'
import { handleDM } from './decoder.js'
export default {
  name: 'testmedia',
  enabled: () => true,
  commands,
  register(client, ctx) {
    client.on('messageCreate', async (message) => {
      if (message.author.bot) return
      if (message.channel.type === ChannelType.DM) await handleDM(message, ctx)
    })
  },
}
