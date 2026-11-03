export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent']

export function readConfig(env = process.env) {
  const config = {
    discordToken: env.DISCORD_TOKEN?.trim() ?? '',
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || null,
    logLevel: env.LOG_LEVEL?.trim() || 'debug',
  }
  const errors = []

  if (!config.discordToken) {
    errors.push(
      'DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.'
    )
  }

  if (config.discordGuildId && !/^\d{17,20}$/.test(config.discordGuildId)) {
    errors.push('DISCORD_GUILD_ID must be a Discord ID of 17 to 20 digits.')
  }

  if (!LOG_LEVELS.includes(config.logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`)
  }

  return { config, errors }
}
