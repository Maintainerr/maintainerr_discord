// Builders for Maintainerr test-media payloads. Every test starts from a valid
// shape and overrides only the field under test, so a failure points at the
// field rather than at a hand-assembled payload being wrong.

export function rule(overrides = {}) {
  return {
    firstValueName: 'Plex - Rating',
    firstValue: 5,
    action: 'bigger',
    secondValueName: 'number',
    secondValue: 3,
    result: true,
    operator: null,
    ...overrides,
  }
}

export function section(rules, overrides = {}) {
  return {
    result: true,
    operator: null,
    ruleResults: rules,
    ...overrides,
  }
}

export function item(sections, overrides = {}) {
  return {
    mediaServerId: '12345',
    result: true,
    sectionResults: sections,
    ...overrides,
  }
}

export function payload(sections, itemOverrides = {}) {
  return { code: 1, result: [item(sections, itemOverrides)] }
}

// Formats a single rule and returns just its detail object, which is what most
// of the rule-comparison assertions care about.
export function formatOneRule(formatMaintainerrResult, ruleOverrides) {
  const result = formatMaintainerrResult(
    payload([section([rule(ruleOverrides)])])
  )
  return result.items[0].sections[0].rules[0]
}
