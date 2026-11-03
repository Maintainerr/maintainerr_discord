import { createReportDiscord } from './discord.js'
import { createDiscordRelay } from '../../github/discord-relay.js'
import { createBridge } from '../../github/bridge.js'
import { createGitHub } from '../../github/client.js'
import { describeError } from '../../lib/logging.js'

export default {
  name: 'reports',
  enabled: (config) => config.featureReports,
  commands: [],
  register(client, ctx) {
    ctx.relay = createDiscordRelay(client, ctx)
    ctx.reports = createReportDiscord(client, ctx)
    client.on('interactionCreate', (interaction) =>
      ctx.reports.interaction(interaction)
    )
    client.on('messageCreate', (message) => ctx.reports.message(message))
    client.once('clientReady', async () => {
      try {
        await ctx.reports.ready()
        if (ctx.config.githubEnabled) {
          const bridge = createBridge({
            ...ctx,
            github: createGitHub(ctx.config),
          })
          ctx.cleanup.push(() => bridge.stop())
          bridge.start()
        } else
          ctx.logger.debug(
            'GitHub publishing is disabled. Reports stay in Discord.'
          )
      } catch (err) {
        ctx.logger.warn(
          'Report setup failed. Check the forum, launcher and bot permissions:',
          describeError(err)
        )
      }
    })
  },
}
