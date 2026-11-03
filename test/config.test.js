import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, LOG_LEVELS } from '../src/config.js'

test('only the Discord token is required and logging defaults to debug', () => {
  const { config, errors } = readConfig({ DISCORD_TOKEN: 'fake-token' })
  assert.deepEqual(errors, [])
  assert.equal(config.discordToken, 'fake-token')
  assert.equal(config.discordGuildId, null)
  assert.equal(config.logLevel, 'debug')
  for (const key of [
    'featureReports',
    'featureSupport',
    'featureSmartDecoder',
    'featureScreenshots',
    'featureTriage',
  ])
    assert.equal(config[key], false)
})

test('configuration reports all errors without echoing invalid values', () => {
  const { errors } = readConfig({
    DISCORD_TOKEN: ' ',
    DISCORD_GUILD_ID: 'invalid-guild',
    LOG_LEVEL: 'invalid-level',
  })

  assert.equal(errors.length, 3)
  for (const variable of ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'LOG_LEVEL']) {
    assert.ok(errors.some((error) => error.startsWith(variable)))
  }
  assert.doesNotMatch(errors.join('\n'), /invalid-guild|invalid-level/)
})

test('optional configuration accepts valid IDs and documented log levels', () => {
  for (const id of ['12345678901234567', '12345678901234567890']) {
    for (const level of LOG_LEVELS) {
      const { config, errors } = readConfig({
        DISCORD_TOKEN: ' fake-token ',
        DISCORD_GUILD_ID: ` ${id} `,
        LOG_LEVEL: level,
      })
      assert.deepEqual(errors, [])
      assert.equal(config.discordToken, 'fake-token')
      assert.equal(config.discordGuildId, id)
      assert.equal(config.logLevel, level)
    }
  }

  assert.deepEqual(
    readConfig({
      DISCORD_TOKEN: 'fake-token',
      DISCORD_GUILD_ID: ' ',
      LOG_LEVEL: '',
    }),
    readConfig({ DISCORD_TOKEN: 'fake-token' })
  )
  for (const id of [
    '1234567890123456',
    '123456789012345678901',
    'guild-name',
  ]) {
    assert.equal(
      readConfig({ DISCORD_TOKEN: 'fake-token', DISCORD_GUILD_ID: id }).errors
        .length,
      1
    )
  }
})

test('reports cannot be enabled without naming the target repository', () => {
  const base = {
    DISCORD_TOKEN: 'fake-token',
    FEATURE_REPORTS: 'true',
    DISCORD_FORUM_CHANNEL_ID: '123456789012345678',
    DISCORD_LAUNCHER_CHANNEL_ID: '123456789012345679',
    DISCORD_STAFF_ROLE_ID: '123456789012345670',
  }
  // No default target: enabling reports with no repository must not silently
  // fall back to the production tracker.
  const missing = readConfig(base)
  assert.equal(missing.config.githubRepository, '')
  assert.ok(missing.errors.some((error) => error.includes('GITHUB_REPOSITORY')))

  const scratch = readConfig({ ...base, GITHUB_REPOSITORY: 'someone/scratch' })
  assert.equal(scratch.config.githubRepository, 'someone/scratch')
  assert.ok(
    !scratch.errors.some((error) => error.includes('GITHUB_REPOSITORY'))
  )
})

test('channel and role lists are comma-separated Discord IDs', () => {
  for (const [variable, key] of [
    ['DISCORD_SUPPORT_CHANNEL_IDS', 'supportChannelIds'],
    ['DISCORD_SELF_ROLE_IDS', 'selfRoleIds'],
  ]) {
    const { config, errors } = readConfig({
      DISCORD_TOKEN: 'fake-token',
      [variable]: '123456789012345678, 223456789012345678,123456789012345678',
    })
    assert.deepEqual(config[key], ['123456789012345678', '223456789012345678'])
    assert.deepEqual(errors, [])
    assert.ok(
      readConfig({
        DISCORD_TOKEN: 'fake-token',
        [variable]: '123456789012345678,support',
      }).errors.some((error) => error.includes(variable))
    )
  }
})

test('self-assignable roles fit one message and never include the staff role', () => {
  const ids = [...Array(26).keys()].map(
    (index) => `1234567890123456${String(index).padStart(2, '0')}`
  )
  for (const [env, rejected] of [
    [{ DISCORD_SELF_ROLE_IDS: ids.slice(0, 25).join(',') }, false],
    [{ DISCORD_SELF_ROLE_IDS: ids.join(',') }, true],
    [{ DISCORD_SELF_ROLE_IDS: ids[0], DISCORD_STAFF_ROLE_ID: ids[0] }, true],
  ])
    assert.equal(
      readConfig({ DISCORD_TOKEN: 'fake-token', ...env }).errors.some((error) =>
        error.includes('DISCORD_SELF_ROLE_IDS')
      ),
      rejected
    )
})

test('welcome cannot be enabled without its channel', () => {
  const base = { DISCORD_TOKEN: 'fake-token', FEATURE_WELCOME: 'true' }
  assert.ok(
    readConfig(base).errors.some((error) =>
      error.includes('DISCORD_WELCOME_CHANNEL_ID')
    )
  )
  assert.deepEqual(
    readConfig({ ...base, DISCORD_WELCOME_CHANNEL_ID: '123456789012345678' })
      .errors,
    []
  )
})
