export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent']

export function readConfig(env = process.env) {
  const config = {
    discordToken: env.DISCORD_TOKEN?.trim() ?? '',
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || null,
    logLevel: env.LOG_LEVEL?.trim() || 'debug',
    dbPath: env.MAINTAINERR_DISCORD_DB?.trim() || '/data/bot.sqlite',
    forumChannelId: env.DISCORD_FORUM_CHANNEL_ID?.trim() || null,
    launcherChannelId: env.DISCORD_LAUNCHER_CHANNEL_ID?.trim() || null,
    staffRoleId: env.DISCORD_STAFF_ROLE_ID?.trim() || null,
    supportChannelId: env.DISCORD_SUPPORT_CHANNEL_ID?.trim() || null,
    llmBaseUrl: env.LLM_BASE_URL?.trim() || '',
    llmApiKey: env.LLM_API_KEY || '',
    llmModel: env.LLM_MODEL?.trim() || '',
    docsRepository:
      env.DOCS_REPOSITORY?.trim() || 'Maintainerr/Maintainerr_docs',
    docsRef: env.DOCS_REF?.trim() || 'main',
    docsOrigin: env.DOCS_ORIGIN?.trim() || 'https://docs.maintainerr.info',
  }
  const errors = []
  for (const [key, variable] of Object.entries({
    featureReports: 'FEATURE_REPORTS',
    featureSupport: 'FEATURE_SUPPORT',
    featureSmartDecoder: 'FEATURE_SMART_DECODER',
    featureScreenshots: 'FEATURE_SCREENSHOTS',
    llmVision: 'LLM_VISION',
  })) {
    const value = env[variable]?.trim().toLowerCase() || 'false'
    if (!['true', 'false', '1', '0'].includes(value))
      errors.push(`${variable} must be true or false.`)
    config[key] = value === 'true' || value === '1'
  }
  for (const [key, variable, fallback] of [
    ['llmRpm', 'LLM_REQUESTS_PER_MINUTE', 1],
    ['llmDailyLimit', 'LLM_DAILY_LIMIT', 100],
    ['attachmentMaxBytes', 'ATTACHMENT_MAX_BYTES', 1048576],
  ]) {
    const value = env[variable]?.trim() || String(fallback)
    config[key] = Number(value)
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(config[key]) ||
      config[key] < 1
    ) {
      errors.push(`${variable} must be a positive integer.`)
    }
  }

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

  for (const [key, variable] of [
    ['forumChannelId', 'DISCORD_FORUM_CHANNEL_ID'],
    ['launcherChannelId', 'DISCORD_LAUNCHER_CHANNEL_ID'],
    ['staffRoleId', 'DISCORD_STAFF_ROLE_ID'],
    ['supportChannelId', 'DISCORD_SUPPORT_CHANNEL_ID'],
  ]) {
    if (config[key] && !/^\d{17,20}$/.test(config[key]))
      errors.push(`${variable} must be a Discord ID of 17 to 20 digits.`)
    if (config.featureReports && key !== 'supportChannelId' && !config[key])
      errors.push(`${variable} is required when FEATURE_REPORTS is enabled.`)
  }
  for (const key of ['docsRepository']) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(config[key]))
      errors.push(`${key} must have owner/name format.`)
  }
  for (const key of ['llmBaseUrl', 'docsOrigin']) {
    if (!config[key]) continue
    try {
      const url = new URL(config[key])
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error()
    } catch {
      errors.push(`${key} must be an HTTP or HTTPS URL without credentials.`)
    }
  }
  if (config.llmBaseUrl && !config.llmModel)
    errors.push('LLM_MODEL is required when LLM_BASE_URL is set.')

  return { config, errors }
}
