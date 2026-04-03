import {
  ACTION_DEFINITIONS,
  FIELD_LABEL_RULES,
  SECOND_VALUE_LABELS,
} from './rule-definitions.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function formatValue(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none'
    return value.map((v) => formatValue(v).replace(/^"(.*)"$/, '$1')).join(', ')
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function formatAction(action) {
  return (
    ACTION_DEFINITIONS[action]?.label ??
    String(action ?? 'unknown').replace(/_/g, ' ')
  )
}

function interpolateTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`)
}

function formatDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    return formatValue(value).replace(/^"(.*)"$/, '$1')
  }

  const d = new Date(value)
  if (isNaN(d.getTime())) return value

  return (
    new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(d) + ' UTC'
  )
}

function formatDurationSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const days = value / 86400
  if (Number.isInteger(days)) {
    return `${days} day${days === 1 ? '' : 's'}`
  }

  return `${value} seconds`
}

function normalizeLabel(label = '') {
  return String(label)
    .replace(/^[^-]+ - /, '')
    .replace(/\[list\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDisplayLabel(label) {
  const normalized = normalizeLabel(label)
  return normalized || String(label || 'Value')
}

function getFieldLabel(rule, side) {
  const raw = side === 'first' ? rule.firstValueName : rule.secondValueName
  const normalized = normalizeLabel(raw).toLowerCase()

  for (const definition of FIELD_LABEL_RULES) {
    const actionMatches =
      (definition.action && definition.action === rule.action) ||
      (definition.actions && definition.actions.includes(rule.action)) ||
      (!definition.action && !definition.actions)

    if (!actionMatches || definition.side !== side) continue
    if (definition.includes && !normalized.includes(definition.includes)) continue

    return definition.label
  }

  const normalizedKey = String(raw ?? '').trim().toLowerCase()
  return SECOND_VALUE_LABELS[normalizedKey] ?? getDisplayLabel(raw)
}

function formatFieldValue(rule, side) {
  const value = side === 'first' ? rule.firstValue : rule.secondValue

  if (value === null && side === 'first') {
    const label = normalizeLabel(rule.firstValueName).toLowerCase()
    if (label.includes('last view date')) return 'never'
  }

  if (side === 'second' && String(rule.secondValueName ?? '').toLowerCase() === 'custom_days') {
    const duration = formatDurationSeconds(value)
    if (duration) return duration
  }

  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    return formatDateTime(value)
  }

  return formatValue(value).replace(/^"(.*)"$/, '$1')
}

function describeWhy(rule) {
  const firstLabel = getDisplayLabel(rule.firstValueName)
  const firstValue = formatFieldValue(rule, 'first')
  const secondValue = formatFieldValue(rule, 'second')
  const definition = ACTION_DEFINITIONS[rule.action]
  const templateValues = {
    firstLabel,
    firstValue,
    secondValue,
  }

  if (definition) {
    if (rule.firstValue === null && definition.whyNull) {
      return definition.whyNull
    }

    const template = rule.result ? definition.whyTrue : definition.whyFalse
    if (template) {
      return interpolateTemplate(template, templateValues)
    }
  }

  return `${firstLabel} ${formatAction(rule.action)} ${secondValue}: ${
    rule.result ? 'condition met' : 'condition not met'
  }.`
}

function describeExpectation(rule) {
  const firstLabel = getDisplayLabel(rule.firstValueName)
  const secondLabel = getDisplayLabel(rule.secondValueName)
  const secondValue = formatFieldValue(rule, 'second')
  const definition = ACTION_DEFINITIONS[rule.action]

  if (definition?.expectation) {
    return interpolateTemplate(definition.expectation, {
      firstLabel,
      secondLabel,
      secondValue,
    })
  }

  return `${firstLabel} ${formatAction(rule.action)} ${secondLabel}.`
}

function summarizeFailedSections(sections) {
  const failed = sections
    .map((section, index) => ({ section, index: index + 1 }))
    .filter(({ section }) => !section.result)
    .map(({ index }) => `Section ${index}`)

  if (failed.length === 0) return null
  if (failed.length === 1) return failed[0]
  if (failed.length === 2) return `${failed[0]} and ${failed[1]}`

  return `${failed.slice(0, -1).join(', ')}, and ${failed.at(-1)}`
}

function describeFinalResult(item) {
  const sections = item.sectionResults ?? []
  const failedSummary = summarizeFailedSections(sections)

  if (item.result) {
    return 'The media matched the rule group.'
  }

  if (!failedSummary) {
    return 'The media did not match the rule group.'
  }

  return `The media did not match because ${failedSummary} failed.`
}

function buildRuleChainExpression(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return 'No rules returned'
  }

  let expression = 'Rule 1'

  for (let i = 1; i < rules.length; i += 1) {
    const operator = rules[i].operator ?? 'AND'
    expression += ` ${operator} Rule ${i + 1}`
  }

  return expression
}

function buildRuleGroupExpression(item) {
  const sections = item.sectionResults ?? []
  if (sections.length === 0) {
    return 'No sections returned'
  }

  let expression = `Section 1 (${buildRuleChainExpression(
    sections[0].ruleResults ?? []
  )})`

  for (let i = 1; i < sections.length; i += 1) {
    const operator = sections[i].operator ?? 'AND'
    expression += ` ${operator} Section ${i + 1} (${buildRuleChainExpression(
      sections[i].ruleResults ?? []
    )})`
  }

  return expression
}

function createRuleDetails(rule) {
  const values = [
    {
      label: getFieldLabel(rule, 'first'),
      value: formatFieldValue(rule, 'first'),
    },
  ]

  if (rule.secondValue !== undefined && rule.secondValue !== null && rule.secondValue !== '') {
    values.push({
      label: getFieldLabel(rule, 'second'),
      value: formatFieldValue(rule, 'second'),
    })
  }

  return {
    summary: `${getDisplayLabel(rule.firstValueName)} ${formatAction(rule.action)} ${getDisplayLabel(
      rule.secondValueName
    )}`,
    expectation: describeExpectation(rule),
    result: rule.result ? 'Passed' : 'Failed',
    why: describeWhy(rule),
    operator: rule.operator ?? null,
    values,
  }
}

function createSectionDetails(section, index) {
  return {
    title: `Section ${index + 1}`,
    result: section.result ? 'Passed' : 'Failed',
    operator: section.operator ?? null,
    rules: (section.ruleResults ?? []).map(createRuleDetails),
  }
}

function createItemDetails(item) {
  const sections = item.sectionResults ?? []

  return {
    mediaServerId: item.mediaServerId,
    result: item.result ? 'Matched' : 'Not Matched',
    ruleGroup: buildRuleGroupExpression(item),
    finalExplanation: describeFinalResult(item),
    sections: sections.map(createSectionDetails),
  }
}

export function formatMaintainerrResult(json) {
  if (Array.isArray(json)) {
    if (json.length === 0) {
      return {
        type: 'empty',
        message: 'No media items were returned in the test results. The copied test output was empty.',
      }
    }

    if (json.every((item) => item && Array.isArray(item.sectionResults))) {
      return {
        type: 'success',
        items: json.map(createItemDetails),
      }
    }
  }

  if (typeof json !== 'object' || json === null) {
    throw new Error('Expected a JSON object, but got something else.')
  }

  if (Array.isArray(json.sectionResults)) {
    return {
      type: 'success',
      items: [createItemDetails(json)],
    }
  }

  if (typeof json.code === 'undefined') {
    throw new Error('Missing `code` field. This does not look like a Maintainerr test result.')
  }

  if (json.code === 0) {
    return {
      type: 'error',
      message: `Maintainerr returned an error:\n${json.result}`,
    }
  }

  if (json.code !== 1 || !Array.isArray(json.result)) {
    throw new Error('Unexpected structure. Expected `{ "code": 1, "result": [...] }`.')
  }

  if (json.result.length === 0) {
    return {
      type: 'empty',
      message:
        'No media items were returned in the test results. The rule group may not have found any matching media.',
    }
  }

  return {
    type: 'success',
    items: json.result.map(createItemDetails),
  }
}

export function splitMessage(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text]

  const chunks = []
  const lines = text.split('\n')
  let current = ''

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      if (current) chunks.push(current)
      if (line.length > maxLength) {
        let remaining = line
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength))
          remaining = remaining.slice(maxLength)
        }
        current = remaining
      } else {
        current = line
      }
    } else {
      current = current ? `${current}\n${line}` : line
    }
  }

  if (current) chunks.push(current)
  return chunks
}
