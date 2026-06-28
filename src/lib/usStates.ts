export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const;

export type UsStateCode = (typeof US_STATES)[number][0];

const STATE_CODES = new Set<string>(US_STATES.map(([code]) => code));
const STATE_NAME_TO_CODE = new Map<string, UsStateCode>(
  US_STATES.map(([code, name]) => [name.toLowerCase(), code])
);

export function normalizeUsStateCode(value?: string | null): UsStateCode | null {
  if (!value) return null;

  const trimmed = value.trim();
  const maybeCode = trimmed.toUpperCase().replace(/\./g, '');
  if (STATE_CODES.has(maybeCode)) return maybeCode as UsStateCode;

  const maybeName = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return STATE_NAME_TO_CODE.get(maybeName) ?? null;
}

export function getUsStateName(value?: string | null): string {
  const code = normalizeUsStateCode(value);
  const state = code ? US_STATES.find(([stateCode]) => stateCode === code) : null;
  return state?.[1] ?? value ?? '';
}
