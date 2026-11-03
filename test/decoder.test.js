import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findPaste,
  handleChannelMessage,
  handleDM,
  isTestMediaText,
} from '../src/capabilities/testmedia/decoder.js'
import { stringify } from 'yaml'
import { payload, section, rule } from './helpers.js'

test('the same channel and DM paste produces identical breakdowns and guidance', async () => {
  const content = JSON.stringify(
    payload(
      [
        section([
          rule({
            firstValueName: 'sw_lastWatched',
            firstValue: null,
            result: false,
          }),
        ]),
      ],
      { title: 'The Lantern Orchard', result: false }
    )
  )
  const ctx = {
    config: { featureSmartDecoder: true },
    docs: { ruleLink: () => 'https://docs.example.test/rules/#last-watched' },
  }
  const capture = (messages) => async (message) =>
    messages.push(JSON.parse(JSON.stringify(message)))
  const dm = []
  await handleDM(
    { content, channel: { send: capture(dm) }, reply: capture(dm) },
    ctx
  )
  const channel = []
  let threads = 0
  assert.equal(
    await handleChannelMessage(
      {
        content,
        channel: { isThread: () => false },
        startThread: async () => {
          threads += 1
          return { send: capture(channel) }
        },
      },
      ctx
    ),
    true
  )
  assert.equal(threads, 1)
  assert.ok(dm.some((message) => message.embeds?.length))
  assert.ok(dm.some((message) => message.content?.includes('**Likely Fix**')))
  assert.deepEqual(channel, dm)
})

test('a paste after a sentence, inside a code fence or in an attached file is still found', async () => {
  const paste = JSON.stringify(payload([section([rule()])]))
  assert.ok(
    isTestMediaText(`I have a rule that gives me this result:\n\n${paste}`)
  )
  // YAML has no braces, so only the fenced-block candidate can find it.
  const yamlPaste = stringify(payload([section([rule()])]))
  assert.ok(
    isTestMediaText('See below:\n```yaml\n' + yamlPaste + '```\nThanks!')
  )
  assert.ok(!isTestMediaText('Why is my collection empty?'))
  const sent = []
  await handleDM(
    {
      content: `Here is my result:\n${paste}`,
      channel: { send: async (message) => sent.push(message) },
      reply: async (message) => sent.push(message),
    },
    { config: {} }
  )
  assert.ok(
    sent.some((message) => message.embeds),
    'the paste was not decoded'
  )

  // Discord turns a long paste into message.txt and leaves the message empty.
  let downloads = 0
  const message = {
    content: '',
    attachments: [
      {
        name: 'message.txt',
        contentType: 'text/plain; charset=utf-8',
        size: paste.length,
        url: 'https://cdn.discordapp.com/attachments/1/2/message.txt',
      },
    ],
  }
  const ctx = {
    config: { attachmentMaxBytes: 1048576 },
    logger: { debug() {} },
    fetch: async () => {
      downloads += 1
      return new Response(paste)
    },
  }
  assert.deepEqual(
    await Promise.all([findPaste(message, ctx), findPaste(message, ctx)]),
    [paste, paste]
  )
  assert.equal(downloads, 1, 'both listeners must share one download')
})
