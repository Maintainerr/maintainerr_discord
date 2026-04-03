export const ACTION_DEFINITIONS = {
  bigger: {
    label: 'is greater than',
    expectation: '{firstLabel} must be greater than {secondValue}.',
    whyTrue: '{firstValue} is greater than {secondValue}.',
    whyFalse: '{firstValue} is not greater than {secondValue}.',
  },
  smaller: {
    label: 'is less than',
    expectation: '{firstLabel} must be less than {secondValue}.',
    whyTrue: '{firstValue} is smaller than {secondValue}.',
    whyFalse: '{firstValue} is not smaller than {secondValue}.',
  },
  equals: {
    label: 'equals',
    expectation: '{firstLabel} must equal {secondValue}.',
    whyTrue: '{firstValue} exactly matches {secondValue}.',
    whyFalse: '{firstValue} does not equal {secondValue}.',
  },
  not_equals: {
    label: 'does not equal',
    expectation: '{firstLabel} must not equal {secondValue}.',
    whyTrue: '{firstValue} is different from {secondValue}.',
    whyFalse: '{firstValue} equals {secondValue}, so the condition failed.',
  },
  contains: {
    label: 'contains',
    expectation: '{firstLabel} must contain {secondValue}.',
    whyTrue: '{firstLabel} matched {secondValue}.',
    whyFalse: '{firstLabel} did not match {secondValue}.',
  },
  contains_partial: {
    label: 'partially contains',
  },
  not_contains: {
    label: 'does not contain',
    expectation: '{firstLabel} must not contain {secondValue}.',
    whyTrue: '{firstLabel} does not include {secondValue}.',
    whyFalse: '{firstLabel} includes {secondValue}, so the condition failed.',
  },
  before: {
    label: 'is before',
    expectation: '{firstLabel} must be before {secondValue}.',
    whyTrue: 'The media was before the cutoff date.',
    whyFalse: 'The media was after the cutoff date, not before it.',
    whyNull: 'There is no date value to compare, so the condition failed.',
  },
  after: {
    label: 'is after',
    expectation: '{firstLabel} must be after {secondValue}.',
    whyTrue: 'The media was after the cutoff date.',
    whyFalse: 'The media was before the cutoff date, not after it.',
    whyNull: 'There is no date value to compare, so the condition failed.',
  },
  in_last: {
    label: 'is within the last',
  },
  not_in_last: {
    label: 'is not within the last',
  },
  between: {
    label: 'is between',
  },
  bigger_equals: {
    label: 'is greater than or equal to',
  },
  smaller_equals: {
    label: 'is less than or equal to',
  },
}

export const FIELD_LABEL_RULES = [
  {
    action: 'contains',
    side: 'first',
    includes: 'viewed by',
    label: 'Actual viewed-by list',
  },
  {
    action: 'contains',
    side: 'second',
    includes: 'requested by user',
    label: 'Requested by user',
  },
  {
    action: 'not_contains',
    side: 'first',
    includes: 'tags',
    label: 'Actual tags',
  },
  {
    actions: ['before', 'after'],
    side: 'first',
    includes: 'last view date',
    label: 'Last viewed',
  },
  {
    actions: ['before', 'after'],
    side: 'first',
    label: 'Downloaded date',
  },
  {
    actions: ['before', 'after'],
    side: 'second',
    label: 'Cutoff date',
  },
]

export const SECOND_VALUE_LABELS = {
  number: 'Threshold',
  custom_days: 'Cutoff',
}
