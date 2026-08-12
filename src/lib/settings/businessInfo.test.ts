import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_REGISTRATION_LOCK_CODE } from './registrationLockCopy';
import {
  buildBusinessInfoSettingsRequest,
  BusinessInfoSettingsSaveError,
  persistBusinessInfoSettings,
  presentBusinessInfoSettingsSaveError,
  type BusinessInfoSettingsInput,
  validateBusinessContactPhone,
  validateBusinessInfoSettings,
} from './businessInfo';

const blankInput: BusinessInfoSettingsInput = {
  phoneNumber: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

describe('validateBusinessContactPhone', () => {
  it('trims a valid phone and maps a cleared phone to null', () => {
    expect(validateBusinessContactPhone('  (317) 555-0100  ')).toEqual({
      success: true,
      value: '(317) 555-0100',
      payload: '(317) 555-0100',
    });
    expect(validateBusinessContactPhone('   ')).toEqual({
      success: true,
      value: '',
      payload: null,
    });
  });

  it('rejects a nonblank phone shorter than ten trimmed characters', () => {
    expect(validateBusinessContactPhone('555-0100')).toEqual({
      success: false,
      error: 'Enter a valid business contact phone number',
    });
  });
});

describe('validateBusinessInfoSettings', () => {
  it('maps cleared contact and address fields to null', () => {
    expect(
      validateBusinessInfoSettings({
        phoneNumber: '   ',
        address: ' ',
        city: '',
        state: '',
        zip: '  ',
      })
    ).toEqual({
      success: true,
      values: blankInput,
      payload: {
        phone_number: null,
        address: null,
        city: null,
        state: null,
        zip: null,
      },
    });
  });

  it('trims fields and normalizes a valid state name', () => {
    expect(
      validateBusinessInfoSettings({
        phoneNumber: '  (317) 555-0100  ',
        address: '  123 Main Street ',
        city: ' Indianapolis ',
        state: ' indiana ',
        zip: ' 46204 ',
      })
    ).toEqual({
      success: true,
      values: {
        phoneNumber: '(317) 555-0100',
        address: '123 Main Street',
        city: 'Indianapolis',
        state: 'IN',
        zip: '46204',
      },
      payload: {
        phone_number: '(317) 555-0100',
        address: '123 Main Street',
        city: 'Indianapolis',
        state: 'IN',
        zip: '46204',
      },
    });
  });

  it('rejects a nonblank phone shorter than ten trimmed characters', () => {
    const result = validateBusinessInfoSettings({
      ...blankInput,
      phoneNumber: '555-0100',
    });

    expect(result).toEqual({
      success: false,
      errors: {
        phoneNumber: 'Enter a valid business contact phone number',
      },
    });
  });

  it('rejects a partial address', () => {
    const result = validateBusinessInfoSettings({
      ...blankInput,
      address: '123 Main Street',
    });

    expect(result).toEqual({
      success: false,
      errors: {
        city: 'City is required',
        state: 'State is required',
        zip: 'ZIP code is required',
      },
    });
  });

  it('rejects invalid state and short ZIP values', () => {
    const result = validateBusinessInfoSettings({
      ...blankInput,
      address: '123 Main Street',
      city: 'Indianapolis',
      state: 'Not a state',
      zip: '1234',
    });

    expect(result).toEqual({
      success: false,
      errors: {
        zip: 'Enter a valid ZIP code',
        state: 'Select a valid state',
      },
    });
  });
});

describe('persistBusinessInfoSettings', () => {
  const fullRequest: BusinessInfoSettingsInput = {
    phoneNumber: '(317) 555-0100',
    address: '123 Main Street',
    city: 'Indianapolis',
    state: 'IN',
    zip: '46204',
  };

  it('sends a full unlocked update to the authenticated settings endpoint', async () => {
    const fetchSettings = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await persistBusinessInfoSettings(fullRequest, fetchSettings);

    expect(fetchSettings).toHaveBeenCalledExactlyOnceWith(
      '/api/settings/business-info',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullRequest),
      }
    );
  });

  it('preserves the status, code, and exact server error on a rejected save', async () => {
    const fetchSettings = vi.fn().mockResolvedValue(
      Response.json(
        {
          code: SETTINGS_REGISTRATION_LOCK_CODE,
          error: 'Contact support to change your business address.',
        },
        { status: 403 }
      )
    );

    await expect(
      persistBusinessInfoSettings(fullRequest, fetchSettings)
    ).rejects.toMatchObject({
      name: 'BusinessInfoSettingsSaveError',
      status: 403,
      code: SETTINGS_REGISTRATION_LOCK_CODE,
      message: 'Contact support to change your business address.',
    });
  });

  it('uses stable fallback copy when a failed response is not JSON', async () => {
    const fetchSettings = vi
      .fn()
      .mockResolvedValue(new Response('not-json', { status: 500 }));

    await expect(
      persistBusinessInfoSettings(fullRequest, fetchSettings)
    ).rejects.toMatchObject({
      status: 500,
      code: null,
      message:
        'Could not save your business contact information. Please try again.',
    });
  });
});

describe('buildBusinessInfoSettingsRequest', () => {
  const values: BusinessInfoSettingsInput = {
    phoneNumber: '(317) 555-0100',
    address: '123 Main Street',
    city: 'Indianapolis',
    state: 'IN',
    zip: '46204',
  };

  it('keeps every editable field while registration is unlocked', () => {
    expect(buildBusinessInfoSettingsRequest(values, false)).toEqual(values);
  });

  it('sends only contact phone while registration is locked', () => {
    expect(buildBusinessInfoSettingsRequest(values, true)).toEqual({
      phoneNumber: '(317) 555-0100',
    });
  });
});

describe('presentBusinessInfoSettingsSaveError', () => {
  it('refreshes server state on the exact stale-lock response', () => {
    const refresh = vi.fn();
    const error = new BusinessInfoSettingsSaveError(
      'Address settings are now locked.',
      403,
      SETTINGS_REGISTRATION_LOCK_CODE
    );

    expect(presentBusinessInfoSettingsSaveError(error, refresh)).toBe(
      'Address settings are now locked.'
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    [403, 'different_code'],
    [409, SETTINGS_REGISTRATION_LOCK_CODE],
  ])('does not refresh for status %i and code %s', (status, code) => {
    const refresh = vi.fn();
    const error = new BusinessInfoSettingsSaveError(
      'Save rejected.',
      status,
      code
    );

    expect(presentBusinessInfoSettingsSaveError(error, refresh)).toBe(
      'Save rejected.'
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses stable fallback copy for network and other unexpected errors', () => {
    expect(
      presentBusinessInfoSettingsSaveError(new Error('offline'), vi.fn())
    ).toBe(
      'Could not save your business contact information. Please try again.'
    );
  });
});
