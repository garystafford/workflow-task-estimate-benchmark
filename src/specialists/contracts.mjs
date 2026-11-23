export const str = { type: 'string' };
export const num = { type: 'integer' };
export const nullable = { type: ['string', 'null'] };
export const money = { type: ['integer', 'null'] };
export const list = { type: 'array', items: str };
export const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
