import { GatewayIntentBits } from 'discord.js'
import testmedia from './testmedia/index.js'
import support from './support/index.js'
import reports from './reports/index.js'
import welcome from './welcome/index.js'

const capabilities = [testmedia, support, reports, welcome]
export default capabilities

// Extra intents come only from enabled capabilities, so shipping a feature whose
// privileged intent is still off in the developer portal cannot break login.
export const gatewayIntents = (config) => [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  ...capabilities
    .filter((capability) => capability.enabled(config))
    .flatMap((capability) => capability.intents ?? []),
]
