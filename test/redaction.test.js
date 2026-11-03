import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'dotenv'
import { redactSecrets, redactObject } from '../src/lib/redaction.js'

const envSecrets = {
  PLEX_TOKEN: 'fakePlex111',
  JELLYFIN_API_KEY: 'fakeJf222',
  EMBY_API_KEY: 'fakeEmby333',
  RADARR_API_KEY: 'fakeRadarr333',
  SONARR_APIKEY: 'fakeSonarr444',
  TAUTULLI_APIKEY: 'fakeTaut555',
  OVERSEERR_API_KEY: 'fakeSeerr666',
  SEERR_API_KEY: 'fakeSeerr777',
  QBITTORRENT_PASSWORD: 'fakeQbit888',
}

test('a complete env paste redacts prefixed credentials and preserves non-secret settings', () => {
  const input = [
    '# diagnostic configuration',
    'PORT=1234',
    ...Object.entries(envSecrets).map(([key, value]) => `${key}=${value}`),
    'FEATURE_REPORTS=true',
  ].join('\n')
  const output = redactSecrets(input)
  for (const [key, value] of Object.entries(envSecrets)) {
    assert.ok(!output.includes(value), `${key} leaked`)
    assert.ok(output.includes(`${key}=[redacted]`), `${key} label was lost`)
  }
  assert.ok(output.startsWith('# diagnostic configuration\nPORT=1234\n'))
  assert.ok(output.endsWith('\nFEATURE_REPORTS=true'))
})

test('bare secrets, prefixed secrets, compose assignments and Token authorization are redacted', () => {
  const cases = [
    'token=fakeToken123',
    '"token": "fakeToken123"',
    'secret=fakeToken123',
    'client_secret: fakeToken123',
    'Authorization: Token fakeToken123',
    'Authorization: Bearer fakeToken123',
    'Authorization: Basic fakeToken123',
    'HTTP_AUTHORIZATION: Token fakeToken123',
    'MY-SERVICE-AUTHORIZATION=Bearer fakeToken123',
    'MY-SERVICE-API-KEY=fakeToken123',
    'radarr_api_key: "fakeToken123"',
    '- SONARR_APIKEY=fakeToken123',
    'GITHUB_PRIVATE_KEY="fakeToken123"',
    'MY_SERVICE_CLIENT_SECRET=fakeToken123',
  ]
  for (const assignment of cases) {
    const output = redactSecrets(`before ${assignment} after`)
    assert.ok(!output.includes('fakeToken123'), assignment)
    assert.ok(output.startsWith('before '), assignment)
    assert.ok(output.endsWith(' after'), assignment)
  }
})

test('environment values redact completely while log context and URL parameters survive', () => {
  for (const secret of [
    'fakeStart;fakeRemainder',
    'fakeOne,fakeTwo',
    'fake one two',
    'fakeOne&fakeRemainder',
    'fakeOne\"fakeTwo\'fakeThree<>}]',
  ]) {
    assert.equal(
      parse(`QBITTORRENT_PASSWORD=${secret}`).QBITTORRENT_PASSWORD,
      secret
    )
    for (const [prefix, separator] of [
      ['', '='],
      ['export ', '='],
      ['  - ', '='],
      ['  ', ': '],
    ]) {
      const output = redactSecrets(
        `before\n${prefix}QBITTORRENT_PASSWORD${separator}${secret}\nafter`
      )
      assert.equal(
        output,
        `before\n${prefix}QBITTORRENT_PASSWORD${separator}[redacted]\nafter`
      )
      assert.equal(redactSecrets(output), output)
    }
  }
  assert.equal(
    redactSecrets('https://plex.local/l?X-Plex-Token=fakeTok,tail;rest&page=2'),
    'https://plex.local/l?X-Plex-Token=[redacted]&page=2'
  )
  assert.equal(
    redactSecrets('log api_key=fakeToken, status=ok'),
    'log api_key=[redacted], status=ok'
  )
  assert.equal(
    redactSecrets('API_KEY=`fakeStart\nfakeEnd`\nPORT=1234'),
    'API_KEY=`[redacted]`\nPORT=1234'
  )
})

test('structured and repeatedly escaped JSON use the same prefixed-key policy', () => {
  const input = {
    ...envSecrets,
    nested: { client_secret: 'nestedFakeSecret', token: 'nestedFakeToken' },
    PORT: 1234,
  }
  const clean = redactObject(input)
  for (const key of Object.keys(envSecrets))
    assert.equal(clean[key], '[redacted]')
  assert.equal(clean.PORT, 1234)
  let encoded = JSON.stringify(input)
  for (let depth = 0; depth < 3; depth += 1) {
    assert.doesNotMatch(
      redactSecrets(encoded),
      /fakePlex111|fakeJf222|nestedFakeSecret|nestedFakeToken/
    )
    encoded = JSON.stringify(encoded)
  }
})

test('quoted env values redact escaped quotes and multiline private keys', () => {
  const input =
    'before QBITTORRENT_PASSWORD="fakeStart\\"fakeEnd" after\nGITHUB_PRIVATE_KEY="fakeKeyStart\nfakeKeyEnd"'
  const output = redactSecrets(input)
  assert.doesNotMatch(output, /fakeStart|fakeEnd|fakeKeyStart|fakeKeyEnd/)
  assert.ok(output.startsWith('before QBITTORRENT_PASSWORD="[redacted]" after'))
})

test('standalone and incomplete PEM private keys are removed before egress', () => {
  const complete =
    'before -----BEGIN PRIVATE KEY-----\nfakePrivateBytes\n-----END PRIVATE KEY----- after'
  assert.equal(redactSecrets(complete), 'before [redacted private key] after')
  assert.equal(
    redactSecrets('before -----BEGIN RSA PRIVATE KEY-----\nfakePrivateBytes'),
    'before [redacted private key]'
  )
})

test('service identifiers survive while login names and credential pairs are redacted', () => {
  const identifiers = {
    plex_username: 'daniel',
    github_username: 'triage-helper',
  }
  assert.deepEqual(redactObject(identifiers), identifiers)
  assert.equal(
    redactSecrets(JSON.stringify(identifiers)),
    JSON.stringify(identifiers)
  )
  assert.equal(
    redactSecrets('plex_username=daniel\ngithub_username=triage-helper'),
    'plex_username=daniel\ngithub_username=triage-helper'
  )
  const cases = [
    'qbittorrent_username=fakeLogin',
    'username=fakeLogin&password=fakePassword',
    'plex_username=fakeLogin&password=fakePassword',
    'plex_username=fakeLogin\nplex_password=fakePassword',
    'github-password: fakePassword\ngithub-username: fakeLogin',
    'https://fakeLogin:fakePassword@example.test',
    JSON.stringify({ username: 'fakeLogin', password: 'fakePassword' }),
    JSON.stringify({
      plex_username: 'fakeLogin',
      plex_password: 'fakePassword',
    }),
    JSON.stringify({ github_username: 'fakeLogin', password: 'fakePassword' }),
    JSON.stringify({ qbittorrent_username: 'fakeLogin' }),
    'log: \\"plex_username\\": \\"fakeLogin\\", \\"plex_password\\": \\"fakePassword\\"',
  ]
  for (const input of cases)
    assert.doesNotMatch(redactSecrets(input), /fakeLogin|fakePassword/, input)
})
