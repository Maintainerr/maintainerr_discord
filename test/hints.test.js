import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestFixes } from '../src/capabilities/testmedia/hints.js'
import { payload, section, rule } from './helpers.js'

test('the four known missing-value cases get deterministic fixes without a model', () => {
  const cases = [
    [
      { firstValueName: 'sw_lastWatched', firstValue: '' },
      /nobody has watched/,
    ],
    [
      { firstValueName: 'Radarr - Added date', firstValue: undefined },
      /lookup returned no value/,
    ],
    [{ action: 'before', firstValue: null }, /no date to compare/],
    [{ firstValue: null }, /operand is missing/],
  ]
  for (const [overrides, expected] of cases) {
    const fixes = suggestFixes(payload([section([rule(overrides)])]))
    assert.equal(fixes.length, 1)
    assert.match(fixes[0], expected)
  }
})

test('a deliberate existence check and a valid comparison do not get missing-value hints', () => {
  for (const firstValueName of [
    'Plex title',
    'sw_lastWatched',
    'Radarr - Added date',
    'Sonarr - Added date',
  ])
    for (const action of ['exists', 'not_exists'])
      for (const firstValue of [undefined, null, '', []])
        assert.deepEqual(
          suggestFixes(
            payload([
              section([
                rule(),
                rule({
                  firstValueName,
                  action,
                  firstValue,
                  result: action === 'not_exists',
                }),
              ]),
            ])
          ),
          [],
          `${firstValueName}: ${action}`
        )
})
