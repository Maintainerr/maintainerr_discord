import { UNARY_ACTIONS } from './rule-definitions.js'

const missing = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && !value.length)

export function payloadItems(payload) {
  if (Array.isArray(payload)) return payload
  if (payload?.code === 1 && Array.isArray(payload.result))
    return payload.result
  return payload?.sectionResults ? [payload] : []
}

export function suggestFixes(payload) {
  const fixes = new Set()
  for (const item of payloadItems(payload)) {
    for (const section of item.sectionResults ?? []) {
      for (const rule of section.ruleResults ?? []) {
        const firstMissing = missing(rule.firstValue)
        const secondMissing =
          !UNARY_ACTIONS.has(rule.action) && missing(rule.secondValue)
        if (firstMissing && /sw_lastWatched/i.test(rule.firstValueName ?? '')) {
          fixes.add(
            'An empty sw_lastWatched can mean nobody has watched this show. Add a separate rule for never-watched media instead of comparing an empty watch date.'
          )
        } else if (
          [
            ['first', firstMissing],
            ['second', secondMissing],
          ].some(
            ([side, absent]) =>
              absent && /radarr|sonarr/i.test(rule[`${side}ValueName`] ?? '')
          )
        ) {
          fixes.add(
            'The Radarr or Sonarr lookup returned no value. Check the integration connection, selected server and media mapping before changing the comparison. The rule failed closed.'
          )
        } else if (
          firstMissing &&
          ['before', 'after', 'in_last', 'in_next'].includes(rule.action)
        ) {
          fixes.add(
            'This date rule has no date to compare. Check whether the source supplies that date, and handle missing dates with an exists or not_exists rule.'
          )
        } else if (
          (firstMissing || secondMissing) &&
          !UNARY_ACTIONS.has(rule.action)
        ) {
          fixes.add(
            'A comparison operand is missing. Check the source field and use an exists or not_exists rule to handle missing values explicitly.'
          )
        }
      }
    }
  }
  return [...fixes]
}

export function ruleFields(payload) {
  return [
    ...new Set(
      payloadItems(payload)
        .flatMap((item) =>
          (item.sectionResults ?? []).flatMap((section) =>
            (section.ruleResults ?? []).flatMap((rule) => [
              rule.firstValueName,
              rule.secondValueName,
            ])
          )
        )
        .filter(Boolean)
    ),
  ]
}
