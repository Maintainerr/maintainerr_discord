import test from 'node:test'
import assert from 'node:assert/strict'

import { formatMaintainerrResult, splitMessage } from '../src/formatter.js'
import { rule, section, item, payload, formatOneRule } from './helpers.js'

const one = (overrides) => formatOneRule(formatMaintainerrResult, overrides)

// ---------------------------------------------------------------------------
// Payload shapes the bot has to reject rather than half-render
// ---------------------------------------------------------------------------

test('rejects payloads that are not objects', () => {
  for (const bad of ['a string', 42, true, null]) {
    assert.throws(
      () => formatMaintainerrResult(bad),
      /Expected a JSON object/,
      `should have rejected ${JSON.stringify(bad)}`
    )
  }
})

test('rejects an object with no code field', () => {
  assert.throws(
    () => formatMaintainerrResult({ something: 'else' }),
    /Missing `code` field/
  )
})

test('rejects a code that is neither 0 nor a well formed 1', () => {
  assert.throws(
    () => formatMaintainerrResult({ code: 2, result: [] }),
    /Unexpected structure/
  )
  assert.throws(
    () => formatMaintainerrResult({ code: 1, result: 'not an array' }),
    /Unexpected structure/
  )
})

test('surfaces a server side error as an error result, not a throw', () => {
  const out = formatMaintainerrResult({ code: 0, result: 'rule group not found' })
  assert.equal(out.type, 'error')
  assert.match(out.message, /rule group not found/)
})

test('reports an empty result set distinctly from an empty array payload', () => {
  const emptyResult = formatMaintainerrResult({ code: 1, result: [] })
  assert.equal(emptyResult.type, 'empty')
  assert.match(emptyResult.message, /may not have found any matching media/)

  const emptyArray = formatMaintainerrResult([])
  assert.equal(emptyArray.type, 'empty')
  assert.match(emptyArray.message, /copied test output was empty/)
})

test('accepts a bare item and an array of items, not just the code envelope', () => {
  const bare = formatMaintainerrResult(item([section([rule()])]))
  assert.equal(bare.type, 'success')
  assert.equal(bare.items.length, 1)

  const asArray = formatMaintainerrResult([
    item([section([rule()])]),
    item([section([rule()])]),
  ])
  assert.equal(asArray.type, 'success')
  assert.equal(asArray.items.length, 2)
})

// ---------------------------------------------------------------------------
// Rule comparison: the why/expectation text per action
// ---------------------------------------------------------------------------

test('numeric comparison explains both outcomes', () => {
  const passed = one({ action: 'bigger', firstValue: 5, secondValue: 3, result: true })
  assert.equal(passed.result, 'Passed')
  assert.equal(passed.why, '5 is greater than 3.')
  assert.equal(passed.expectation, 'Rating must be greater than 3.')

  const failed = one({ action: 'bigger', firstValue: 1, secondValue: 3, result: false })
  assert.equal(failed.result, 'Failed')
  assert.equal(failed.why, '1 is not greater than 3.')
})

test('equality actions describe the failing direction', () => {
  assert.equal(
    one({ action: 'not_equals', firstValue: 2, secondValue: 2, result: false }).why,
    '2 equals 2, so the condition failed.'
  )
  assert.equal(
    one({ action: 'equals', firstValue: 2, secondValue: 2, result: true }).why,
    '2 exactly matches 2.'
  )
})

test('count actions report the count, not the raw list', () => {
  const detail = one({
    action: 'count_bigger',
    firstValue: ['a', 'b', 'c'],
    secondValue: 2,
    result: true,
  })
  assert.equal(detail.why, 'Rating contains 3 items, which is more than 2.')
  assert.equal(detail.expectation, 'Rating must contain more than 2 items.')
})

test('count of a non countable first value degrades instead of printing undefined', () => {
  const detail = one({
    action: 'count_equals',
    firstValue: null,
    secondValue: 2,
    result: false,
  })
  assert.match(detail.why, /an unknown number of/)
  assert.doesNotMatch(detail.why, /undefined|NaN/)
})

test('date comparison with no date uses the null explanation', () => {
  const detail = one({
    action: 'before',
    firstValueName: 'Plex - Last view date',
    firstValue: null,
    secondValueName: 'custom_days',
    secondValue: 2592000,
    result: false,
  })
  assert.equal(detail.why, 'There is no date value to compare, so the condition failed.')
})

test('unary actions drop the missing second operand from the summary', () => {
  const detail = one({
    action: 'exists',
    firstValueName: 'Plex - Rating',
    secondValueName: undefined,
    secondValue: undefined,
    result: true,
  })
  assert.equal(detail.summary, 'Rating exists')
  assert.doesNotMatch(detail.summary, /undefined/)
  assert.equal(detail.expectation, 'Rating must have a value.')
  assert.equal(detail.values.length, 1, 'no second value row for a unary action')
})

test('an action the server adds later still renders readably', () => {
  const detail = one({ action: 'some_new_action', firstValue: 1, secondValue: 2, result: true })
  assert.match(detail.summary, /some new action/)
  assert.doesNotMatch(detail.why, /undefined/)
  assert.doesNotMatch(detail.expectation, /\{|\}/, 'no unfilled template placeholders')
})

test('template placeholders are always filled', () => {
  const actions = [
    'bigger', 'smaller', 'equals', 'not_equals', 'contains', 'not_contains',
    'before', 'after', 'contains_all', 'not_contains_all', 'not_contains_partial',
    'count_equals', 'count_not_equals', 'count_bigger', 'count_smaller',
    'exists', 'not_exists',
  ]
  for (const action of actions) {
    for (const result of [true, false]) {
      const detail = one({ action, firstValue: ['x'], secondValue: 1, result })
      assert.doesNotMatch(
        detail.why,
        /\{[a-zA-Z]+\}/,
        `unfilled placeholder in why for ${action}/${result}`
      )
      assert.doesNotMatch(
        detail.expectation,
        /\{[a-zA-Z]+\}/,
        `unfilled placeholder in expectation for ${action}/${result}`
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

test('formats each value type the way a reader expects', () => {
  const valueOf = (firstValue) => one({ firstValue }).values[0].value

  assert.equal(valueOf(['a', 'b']), 'a, b', 'arrays join without quotes')
  assert.equal(valueOf([]), 'none', 'an empty list is not an empty string')
  assert.equal(valueOf(true), 'Yes')
  assert.equal(valueOf(false), 'No')
  assert.equal(valueOf('a title'), 'a title', 'strings lose their wrapping quotes')
  assert.equal(valueOf(42), '42')
  assert.equal(valueOf(null), 'null')
})

test('an ISO timestamp becomes a readable UTC datetime', () => {
  const detail = one({
    action: 'before',
    firstValueName: 'Plex - Last view date',
    firstValue: '2026-01-15T10:30:00.000Z',
    secondValueName: 'custom_days',
    secondValue: 2592000,
    result: true,
  })
  assert.equal(detail.values[0].value, '2026-01-15 10:30 UTC')
})

test('a never viewed item reads as never rather than null', () => {
  const detail = one({
    action: 'before',
    firstValueName: 'Plex - Last view date',
    firstValue: null,
    secondValueName: 'custom_days',
    secondValue: 2592000,
    result: false,
  })
  assert.equal(detail.values[0].value, 'never')
})

test('custom_days renders as days when it divides evenly, seconds otherwise', () => {
  const secondValueOf = (secondValue) =>
    one({
      action: 'before',
      firstValueName: 'Plex - Last view date',
      firstValue: '2026-01-15T10:30:00.000Z',
      secondValueName: 'custom_days',
      secondValue,
      result: true,
    }).values[1].value

  assert.equal(secondValueOf(86400), '1 day', 'singular')
  assert.equal(secondValueOf(2592000), '30 days')
  assert.equal(secondValueOf(3600), '3600 seconds', 'not a whole number of days')
})

test('labels are normalised and mapped to reader facing names', () => {
  // "Plex - " prefix stripped, "[list]" removed, whitespace collapsed.
  assert.equal(one({ firstValueName: 'Plex - Rating' }).values[0].label, 'Rating')
  assert.equal(
    one({ firstValueName: 'Plex - [list] Genres  ' }).values[0].label,
    'Genres'
  )

  // Second-value names map through SECOND_VALUE_LABELS.
  assert.equal(one({ secondValueName: 'number' }).values[1].label, 'Threshold')
})

test('field label rules override the generic label per action', () => {
  assert.equal(
    one({ action: 'contains', firstValueName: 'Plex - Viewed by', firstValue: ['sam'] })
      .values[0].label,
    'Actual viewed-by list'
  )
  assert.equal(
    one({ action: 'not_contains', firstValueName: 'Plex - Tags', firstValue: ['keep'] })
      .values[0].label,
    'Actual tags'
  )
  assert.equal(
    one({
      action: 'before',
      firstValueName: 'Plex - Last view date',
      firstValue: '2026-01-15T10:30:00.000Z',
      secondValueName: 'custom_days',
      secondValue: 86400,
    }).values[0].label,
    'Last viewed'
  )
  assert.equal(
    one({
      action: 'after',
      firstValueName: 'Plex - Release date',
      firstValue: '2026-01-15T10:30:00.000Z',
      secondValueName: 'custom_days',
      secondValue: 86400,
    }).values[0].label,
    'Downloaded date',
    'before/after first side falls back to the generic date label'
  )
})

test('an empty second value produces no second row', () => {
  for (const secondValue of [undefined, null, '']) {
    assert.equal(one({ secondValue }).values.length, 1, `for ${JSON.stringify(secondValue)}`)
  }
})

// ---------------------------------------------------------------------------
// Rule group expression and the final verdict
// ---------------------------------------------------------------------------

test('rule group expression joins rules and sections with their operators', () => {
  const out = formatMaintainerrResult(
    payload([
      section([rule(), rule({ operator: 'OR' })]),
      section([rule()], { operator: 'AND' }),
    ])
  )
  assert.equal(
    out.items[0].ruleGroup,
    'Section 1 (Rule 1 OR Rule 2) AND Section 2 (Rule 1)'
  )
})

test('rule chain defaults to AND when the server omits the operator', () => {
  const out = formatMaintainerrResult(payload([section([rule(), rule({ operator: null })])]))
  assert.equal(out.items[0].ruleGroup, 'Section 1 (Rule 1 AND Rule 2)')
})

test('empty sections and empty rule lists say so instead of rendering blank', () => {
  const noSections = formatMaintainerrResult(payload([]))
  assert.equal(noSections.items[0].ruleGroup, 'No sections returned')

  const noRules = formatMaintainerrResult(payload([section([])]))
  assert.equal(noRules.items[0].ruleGroup, 'Section 1 (No rules returned)')
})

test('final explanation names which sections failed', () => {
  const explain = (sectionResults, result) =>
    formatMaintainerrResult(payload(sectionResults, { result })).items[0].finalExplanation

  assert.equal(
    explain([section([rule()])], true),
    'The media matched the rule group.'
  )
  assert.equal(
    explain([section([rule()], { result: false })], false),
    'The media did not match because Section 1 failed.'
  )
  assert.equal(
    explain(
      [section([rule()], { result: false }), section([rule()], { result: false })],
      false
    ),
    'The media did not match because Section 1 and Section 2 failed.'
  )
  assert.equal(
    explain(
      [
        section([rule()], { result: false }),
        section([rule()], { result: false }),
        section([rule()], { result: false }),
      ],
      false
    ),
    'The media did not match because Section 1, Section 2, and Section 3 failed.'
  )
})

test('a non match with every section passing still explains itself', () => {
  const out = formatMaintainerrResult(payload([section([rule()])], { result: false }))
  assert.equal(out.items[0].finalExplanation, 'The media did not match the rule group.')
  assert.equal(out.items[0].result, 'Not Matched')
})

test('carries the media server id through untouched', () => {
  const out = formatMaintainerrResult(
    payload([section([rule()])], { mediaServerId: 'abc-999' })
  )
  assert.equal(out.items[0].mediaServerId, 'abc-999')
})

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

test('short text is returned as a single chunk', () => {
  assert.deepEqual(splitMessage('hello'), ['hello'])
})

test('splits on line boundaries and never exceeds the limit', () => {
  const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const chunks = splitMessage(text, 50)

  assert.ok(chunks.length > 1, 'should have split')
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 50, `chunk too long: ${chunk.length}`)
  }
  assert.equal(chunks.join('\n'), text, 'round trips without losing content')
})

test('a single line longer than the limit is hard split', () => {
  const chunks = splitMessage('x'.repeat(120), 50)
  assert.deepEqual(chunks.map((c) => c.length), [50, 50, 20])
  assert.equal(chunks.join(''), 'x'.repeat(120))
})

test('text exactly at the limit is not split', () => {
  assert.deepEqual(splitMessage('x'.repeat(50), 50), ['x'.repeat(50)])
})
