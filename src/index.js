import { Client, GatewayIntentBits, Partials } from 'discord.js'
import { config as loadEnv } from 'dotenv'
import { readConfig } from './config.js'
import capabilities from './capabilities/index.js'
import { createCommandRegistry } from './commands/index.js'
import { createLogger, describeError } from './lib/logging.js'
import { createContext } from './runtime.js'

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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
})
let ctx
try {
  ctx = await createContext(config, logger)
} catch (err) {
  logger.error(
    'Could not initialize the bot. Check the database path and volume:',
    describeError(err)
  )
  process.exit(1)
}
const enabledCapabilities = capabilities.filter((capability) =>
  capability.enabled(config)
)
const commands = createCommandRegistry(enabledCapabilities, ctx, capabilities)

for (const capability of capabilities) {
  if (enabledCapabilities.includes(capability)) capability.register(client, ctx)
  logger.debug(
    `${enabledCapabilities.includes(capability) ? 'Enabled' : 'Disabled'} capability: ${capability.name}.`
  )
}
logger.debug(
  `${config.featureScreenshots ? 'Enabled' : 'Disabled'} capability: screenshots.`
)

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
async function shutdown(signal, code = 0) {
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
  for (const cleanup of ctx.cleanup.toReversed()) {
    try {
      await cleanup()
    } catch (err) {
      logger.error('Error while closing bot services:', describeError(err))
    }
  }
  process.exit(code)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
client.login(config.discordToken).catch((err) => {
  logger.error(
    'Discord login failed. Check the token and privileged intents:',
    describeError(err)
  )
  return shutdown('login failure', 1)
})
