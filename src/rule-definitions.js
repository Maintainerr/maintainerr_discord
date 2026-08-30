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
  in_next: {
    label: 'is within the next',
  },
  contains_all: {
    label: 'contains all of',
    expectation: '{firstLabel} must contain every value in {secondValue}.',
    whyTrue: '{firstLabel} contains every value in {secondValue}.',
    whyFalse: '{firstLabel} is missing at least one value from {secondValue}.',
  },
  not_contains_all: {
    label: 'does not contain all of',
    expectation: '{firstLabel} must not contain every value in {secondValue}.',
    whyTrue: '{firstLabel} is missing at least one value from {secondValue}.',
    whyFalse:
      '{firstLabel} contains every value in {secondValue}, so the condition failed.',
  },
  not_contains_partial: {
    label: 'does not partially contain',
    expectation: '{firstLabel} must not partially match {secondValue}.',
    whyTrue: '{firstLabel} does not partially match {secondValue}.',
    whyFalse:
      '{firstLabel} partially matches {secondValue}, so the condition failed.',
  },
  count_equals: {
    label: 'has a count equal to',
    expectation: '{firstLabel} must contain exactly {secondCount} items.',
    whyTrue: '{firstLabel} contains {firstCount} items, which matches {secondCount}.',
    whyFalse: '{firstLabel} contains {firstCount} items, not {secondCount}.',
  },
  count_not_equals: {
    label: 'does not have a count equal to',
    expectation: '{firstLabel} must not contain exactly {secondCount} items.',
    whyTrue:
      '{firstLabel} contains {firstCount} items, which differs from {secondCount}.',
    whyFalse:
      '{firstLabel} contains exactly {secondCount} items, so the condition failed.',
  },
  count_bigger: {
    label: 'has a count greater than',
    expectation: '{firstLabel} must contain more than {secondCount} items.',
    whyTrue:
      '{firstLabel} contains {firstCount} items, which is more than {secondCount}.',
    whyFalse:
      '{firstLabel} contains {firstCount} items, which is not more than {secondCount}.',
  },
  count_smaller: {
    label: 'has a count less than',
    expectation: '{firstLabel} must contain fewer than {secondCount} items.',
    whyTrue:
      '{firstLabel} contains {firstCount} items, which is fewer than {secondCount}.',
    whyFalse:
      '{firstLabel} contains {firstCount} items, which is not fewer than {secondCount}.',
  },
  exists: {
    label: 'exists',
    expectation: '{firstLabel} must have a value.',
    whyTrue: '{firstLabel} has a value ({firstValue}).',
    whyFalse: '{firstLabel} is empty or missing.',
  },
  not_exists: {
    label: 'does not exist',
    expectation: '{firstLabel} must be empty or missing.',
    whyTrue: '{firstLabel} is empty or missing.',
    whyFalse: '{firstLabel} has a value ({firstValue}), so the condition failed.',
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

// Unary actions carry no second operand. The server omits secondValueName
// entirely for these, so anything that renders "<first> <action> <second>"
// has to drop the trailing half rather than print a placeholder.
export const UNARY_ACTIONS = new Set(['exists', 'not_exists'])
