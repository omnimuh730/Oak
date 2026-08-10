const ACTION_TYPES = [
  'fill',
  'upload',
  'select_radio',
  'wait',
  'validate',
  'pause_for_review',
  'forbidden',
];

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableNumberArray = {
  type: ['array', 'null'],
  items: { type: 'number' },
};

const planActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTION_TYPES },
    element_index: nullableNumber,
    element_indexes: nullableNumberArray,
    expected_label: nullableString,
    expected_role: nullableString,
    value: nullableString,
    file: nullableString,
    reason: nullableString,
    ms: nullableNumber,
  },
  required: [
    'action',
    'element_index',
    'element_indexes',
    'expected_label',
    'expected_role',
    'value',
    'file',
    'reason',
    'ms',
  ],
};

export const ACTION_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    goal: { type: 'string' },
    actions: {
      type: 'array',
      items: planActionSchema,
    },
    forbidden_actions: {
      type: 'array',
      items: planActionSchema,
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        required_element_indexes: {
          type: 'array',
          items: { type: 'number' },
        },
        stop_before_submit: { type: 'boolean' },
      },
      required: ['required_element_indexes', 'stop_before_submit'],
    },
    unresolved_items: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'goal',
    'actions',
    'forbidden_actions',
    'validation',
    'unresolved_items',
  ],
};

export const ACTION_PLAN_FORMAT = {
  type: 'json_schema',
  name: 'oak_action_plan',
  strict: true,
  schema: ACTION_PLAN_SCHEMA,
};
