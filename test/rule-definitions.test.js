import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTION_DEFINITIONS,
  FIELD_LABEL_RULES,
  SECOND_VALUE_LABELS,
  UNARY_ACTIONS,
} from '../src/rule-definitions.js'

// The formatter interpolates each template against a fixed set of names. A
// template naming anything else renders the placeholder literally to the user,
// which is why these are checked per field rather than as one combined set.
const WHY_PLACEHOLDERS = new Set([
  'firstLabel',
  'firstValue',
  'secondValue',
  'firstCount',
  'secondCount',
])
const EXPECTATION_PLACEHOLDERS = new Set([
  'firstLabel',
  'secondLabel',
  'secondValue',
  'secondCount',
])

function placeholdersIn(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

test('every action definition has a label', () => {
  for (const [action, definition] of Object.entries(ACTION_DEFINITIONS)) {
    assert.equal(typeof definition.label, 'string', `${action} has no label`)
    assert.ok(definition.label.length > 0, `${action} has an empty label`)
  }
})

test('an action that explains success also explains failure', () => {
  for (const [action, definition] of Object.entries(ACTION_DEFINITIONS)) {
    if (definition.whyTrue) {
      assert.ok(definition.whyFalse, `${action} explains true but not false`)
    }
    if (definition.whyFalse) {
      assert.ok(definition.whyTrue, `${action} explains false but not true`)
    }
  }
})

test('why templates only reference names the formatter supplies', () => {
  for (const [action, definition] of Object.entries(ACTION_DEFINITIONS)) {
    for (const field of ['whyTrue', 'whyFalse', 'whyNull']) {
      const template = definition[field]
      if (!template) continue
      for (const name of placeholdersIn(template)) {
        assert.ok(
          WHY_PLACEHOLDERS.has(name),
          `${action}.${field} uses {${name}}, which the formatter never fills`
        )
      }
    }
  }
})

test('expectation templates only reference names the formatter supplies', () => {
  for (const [action, definition] of Object.entries(ACTION_DEFINITIONS)) {
    if (!definition.expectation) continue
    for (const name of placeholdersIn(definition.expectation)) {
      assert.ok(
        EXPECTATION_PLACEHOLDERS.has(name),
        `${action}.expectation uses {${name}}, which the formatter never fills`
      )
    }
  }
})

test('unary actions are real actions', () => {
  for (const action of UNARY_ACTIONS) {
    assert.ok(
      Object.hasOwn(ACTION_DEFINITIONS, action),
      `${action} is marked unary but has no definition`
    )
  }
})

test('a unary action never asks for a second operand', () => {
  for (const action of UNARY_ACTIONS) {
    const definition = ACTION_DEFINITIONS[action]
    for (const field of ['expectation', 'whyTrue', 'whyFalse', 'whyNull']) {
      const template = definition[field]
      if (!template) continue
      for (const name of placeholdersIn(template)) {
        assert.ok(
          !name.startsWith('second'),
          `unary ${action}.${field} references {${name}}, but there is no second operand`
        )
      }
    }
  }
})

test('field label rules are well formed and target real actions', () => {
  for (const definition of FIELD_LABEL_RULES) {
    assert.ok(definition.label, 'a field label rule has no label')
    assert.ok(
      definition.side === 'first' || definition.side === 'second',
      `bad side: ${definition.side}`
    )

    const actions = definition.actions ?? (definition.action ? [definition.action] : [])
    for (const action of actions) {
      assert.ok(
        Object.hasOwn(ACTION_DEFINITIONS, action),
        `field label rule targets unknown action ${action}`
      )
    }
  }
})

test('field label rules do not use both action and actions', () => {
  for (const definition of FIELD_LABEL_RULES) {
    assert.ok(
      !(definition.action && definition.actions),
      `${definition.label} sets both action and actions, only one is read`
    )
  }
})

test('more specific field label rules come before their fallbacks', () => {
  // getFieldLabel returns the first match, so a rule with no `includes` filter
  // shadows every later rule for the same action and side.
  const seenCatchAll = new Set()

  for (const definition of FIELD_LABEL_RULES) {
    const actions = definition.actions ?? [definition.action]
    for (const action of actions) {
      const key = `${action}/${definition.side}`
      assert.ok(
        !seenCatchAll.has(key),
        `${definition.label} is unreachable: an earlier rule already matches all of ${key}`
      )
      if (!definition.includes) seenCatchAll.add(key)
    }
  }
})

test('second value labels are keyed lowercase', () => {
  // getFieldLabel lowercases before looking up, so a capitalised key never hits.
  for (const key of Object.keys(SECOND_VALUE_LABELS)) {
    assert.equal(key, key.toLowerCase(), `${key} can never match`)
  }
})
