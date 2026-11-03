import { createReportDiscord } from './discord.js'
import { describeError } from '../../lib/logging.js'
export default {
  name: 'reports',
  enabled: (config) => config.featureReports,
  commands: [],
  register(client, ctx) {
    ctx.reports = createReportDiscord(client, ctx)
    client.on('interactionCreate', (interaction) =>
      ctx.reports.interaction(interaction)
    )
    client.on('messageCreate', (message) => ctx.reports.message(message))
    client.once('clientReady', async () => {
      try {
        await ctx.reports.ready()
      } catch (err) {
        ctx.logger.warn(
          'Report setup failed. Check the forum, launcher and bot permissions:',
          describeError(err)
        )
      }
    })
  },
}
