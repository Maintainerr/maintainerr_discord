import test from 'node:test'
import assert from 'node:assert/strict'
import {
  handleChannelMessage,
  handleDM,
} from '../src/capabilities/testmedia/decoder.js'
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
  assert.ok(dm.some((message) => message.content?.includes('**Likely fix**')))
  assert.deepEqual(channel, dm)
})
