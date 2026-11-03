import { Client, GatewayIntentBits, Partials } from 'discord.js'
import { config as loadEnv } from 'dotenv'
import { readConfig } from './config.js'
import capabilities from './capabilities/index.js'
import { createCommandRegistry } from './commands/index.js'
import { createLogger, describeError } from './lib/logging.js'

loadEnv({ quiet: true })
const { config, errors } = readConfig()
if (errors.length) {
  console.error(
    `Configuration errors:\n${errors.map((error) => `- ${error}`).join('\n')}`
  )
  process.exit(1)
}

const logger = createLogger(config.logLevel)
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message],
})
const ctx = { config, logger }
const enabledCapabilities = capabilities.filter((capability) =>
  capability.enabled(config)
)
const commands = createCommandRegistry(enabledCapabilities, ctx)

for (const capability of enabledCapabilities) {
  capability.register(client, ctx)
  logger.debug(`Enabled capability: ${capability.name}.`)
}

client.once('clientReady', async () => {
  logger.debug(`Logged in as ${client.user.tag}`)
  await commands.register(client)
})
client.on('interactionCreate', commands.dispatch)
client.on('error', (err) =>
  logger.error('Discord client error:', describeError(err))
)
process.on('unhandledRejection', (err) =>
  logger.error('Unhandled rejection:', describeError(err))
)

// Signals can race while the gateway connection is closing.
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.debug(`Received ${signal}, closing the Discord connection.`)

  try {
    await client.destroy()
  } catch (err) {
    logger.error(
      'Error while closing the Discord connection:',
      describeError(err)
    )
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
client.login(config.discordToken)
