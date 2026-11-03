import { ChannelType } from 'discord.js'
import { commands } from '../../commands/testmedia.js'
import { allowsScreenshot, inSupportChannel } from './scope.js'
import {
  findPaste,
  handleDM,
  handleChannelMessage,
  handleScreenshot,
  isTestMediaText,
} from './decoder.js'
import { where } from '../../lib/logging.js'

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
      if (message.channel.type === ChannelType.DM) {
        const paste = await findPaste(message, ctx)
        await handleDM(message, ctx, paste ?? message.content)
        ctx.logger.debug(
          `[dm] ${message.author.tag}: ${paste ? 'Test Media paste decoded' : 'no paste found'}`
        )
      } else if (
        ctx.config.featureSmartDecoder &&
        inSupportChannel(message, ctx.config)
      ) {
        const paste = await findPaste(message, ctx)
        if (!paste) return
        await handleChannelMessage(message, ctx, paste)
        ctx.logger.debug(`[decode] ${message.author.tag} in ${where(message)}`)
      }
    })
  },
}
