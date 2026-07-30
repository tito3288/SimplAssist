import type { createClient } from '@/lib/supabase/client';
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

type BrowserSupabaseClient = ReturnType<typeof createClient>;

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

  if (values.phoneNumber && values.phoneNumber.length < 10) {
    errors.phoneNumber = 'Enter a valid business contact phone number';
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
  supabase: BrowserSupabaseClient,
  businessId: string,
  payload: BusinessInfoSettingsPayload
): Promise<void> {
  const { error } = await supabase
    .from('businesses')
    .update(payload)
    .eq('id', businessId);

  if (error) throw error;
}
