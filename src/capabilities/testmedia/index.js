import { ChannelType } from 'discord.js'
import { commands } from '../../commands/testmedia.js'
import { allowsScreenshot } from './scope.js'
import {
  handleDM,
  handleChannelMessage,
  handleScreenshot,
  isTestMediaText,
} from './decoder.js'

export default {
  name: 'testmedia',
  enabled: () => true,
  commands,
  register(client, ctx) {
    client.on('messageCreate', async (message) => {
      if (message.author.bot) return
      if (ctx.reports?.byThread(message.channelId)) return
      if (
        allowsScreenshot(message, ctx.config, client.user?.id) &&
        !isTestMediaText(message.content) &&
        (await handleScreenshot(message, ctx))
      )
        return
      if (message.channel.type === ChannelType.DM) await handleDM(message, ctx)
      else if (ctx.config.featureSmartDecoder)
        await handleChannelMessage(message, ctx)
    })
  },
}
