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
