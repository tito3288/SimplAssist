import { SETTINGS_REGISTRATION_LOCK_CODE } from '@/lib/settings/registrationLockCopy';
import { normalizeUsStateCode } from '@/lib/usStates';

export interface BusinessInfoSettingsInput {
  phoneNumber: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface BusinessInfoSettingsPayload {
  phone_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export type BusinessInfoPhoneSettingsInput = Pick<
  BusinessInfoSettingsInput,
  'phoneNumber'
>;

export type BusinessInfoSettingsRequest =
  | BusinessInfoPhoneSettingsInput
  | BusinessInfoSettingsInput;

export type BusinessInfoSettingsErrors = Partial<
  Record<keyof BusinessInfoSettingsInput, string>
>;

export type BusinessInfoSettingsValidation =
  | {
      success: true;
      payload: BusinessInfoSettingsPayload;
      values: BusinessInfoSettingsInput;
    }
  | {
      success: false;
      errors: BusinessInfoSettingsErrors;
    };

export type BusinessContactPhoneValidation =
  | {
      success: true;
      value: string;
      payload: string | null;
    }
  | {
      success: false;
      error: string;
    };

type FetchBusinessInfoSettings = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type BusinessInfoSettingsErrorBody = {
  code?: unknown;
  error?: unknown;
};

const BUSINESS_INFO_SAVE_FALLBACK =
  'Could not save your business contact information. Please try again.';

export class BusinessInfoSettingsSaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = 'BusinessInfoSettingsSaveError';
  }
}

export function buildBusinessInfoSettingsRequest(
  values: BusinessInfoSettingsInput,
  registrationLocked: boolean
): BusinessInfoSettingsRequest {
  return registrationLocked ? { phoneNumber: values.phoneNumber } : values;
}

export function validateBusinessContactPhone(
  phoneNumber: string
): BusinessContactPhoneValidation {
  const value = phoneNumber.trim();

  if (value && value.length < 10) {
    return {
      success: false,
      error: 'Enter a valid business contact phone number',
    };
  }

  return { success: true, value, payload: value || null };
}

export function validateBusinessInfoSettings(
  input: BusinessInfoSettingsInput
): BusinessInfoSettingsValidation {
  const values = {
    phoneNumber: input.phoneNumber.trim(),
    address: input.address.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    zip: input.zip.trim(),
  };
  const errors: BusinessInfoSettingsErrors = {};

  const phoneValidation = validateBusinessContactPhone(input.phoneNumber);
  if (!phoneValidation.success) {
    errors.phoneNumber = phoneValidation.error;
  }

  const hasAnyAddressPart = Boolean(
    values.address || values.city || values.state || values.zip
  );

  if (hasAnyAddressPart) {
    if (!values.address) errors.address = 'Street address is required';
    if (!values.city) errors.city = 'City is required';
    if (!values.state) errors.state = 'State is required';
    if (!values.zip) {
      errors.zip = 'ZIP code is required';
    } else if (values.zip.length < 5) {
      errors.zip = 'Enter a valid ZIP code';
    }
  }

  const normalizedState = values.state
    ? normalizeUsStateCode(values.state)
    : null;
  if (values.state && !normalizedState) {
    errors.state = 'Select a valid state';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  const normalizedValues: BusinessInfoSettingsInput = {
    ...values,
    state: normalizedState ?? '',
  };

  return {
    success: true,
    values: normalizedValues,
    payload: {
      phone_number: normalizedValues.phoneNumber || null,
      address: normalizedValues.address || null,
      city: normalizedValues.city || null,
      state: normalizedValues.state || null,
      zip: normalizedValues.zip || null,
    },
  };
}

export async function persistBusinessInfoSettings(
  request: BusinessInfoSettingsRequest,
  fetchSettings: FetchBusinessInfoSettings = fetch
): Promise<void> {
  const response = await fetchSettings('/api/settings/business-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as BusinessInfoSettingsErrorBody;
  const message =
    typeof body.error === 'string' && body.error.trim()
      ? body.error
      : BUSINESS_INFO_SAVE_FALLBACK;
  const code = typeof body.code === 'string' ? body.code : null;

  throw new BusinessInfoSettingsSaveError(message, response.status, code);
}

export function presentBusinessInfoSettingsSaveError(
  error: unknown,
  refresh: () => void
): string {
  if (error instanceof BusinessInfoSettingsSaveError) {
    if (
      error.status === 403 &&
      error.code === SETTINGS_REGISTRATION_LOCK_CODE
    ) {
      refresh();
    }
    return error.message;
  }

  return BUSINESS_INFO_SAVE_FALLBACK;
}
