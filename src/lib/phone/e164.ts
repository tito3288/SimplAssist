export const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

export function normalizeE164Input(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function isE164PhoneNumber(value: string): boolean {
  return E164_PHONE_REGEX.test(value);
}
