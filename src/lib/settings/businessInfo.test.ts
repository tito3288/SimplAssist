import { describe, expect, it, vi } from 'vitest';
import {
  persistBusinessInfoSettings,
  type BusinessInfoSettingsInput,
  type BusinessInfoSettingsPayload,
  validateBusinessInfoSettings,
} from './businessInfo';

const blankInput: BusinessInfoSettingsInput = {
  phoneNumber: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

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
  const payload: BusinessInfoSettingsPayload = {
    phone_number: '(317) 555-0100',
    address: '123 Main Street',
    city: 'Indianapolis',
    state: 'IN',
    zip: '46204',
  };

  it('updates the authenticated business row by id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });

    await persistBusinessInfoSettings(
      { from } as unknown as Parameters<typeof persistBusinessInfoSettings>[0],
      'business-123',
      payload
    );

    expect(from).toHaveBeenCalledWith('businesses');
    expect(update).toHaveBeenCalledWith(payload);
    expect(eq).toHaveBeenCalledWith('id', 'business-123');
  });

  it('propagates database errors', async () => {
    const databaseError = new Error('update failed');
    const eq = vi.fn().mockResolvedValue({ error: databaseError });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });

    await expect(
      persistBusinessInfoSettings(
        { from } as unknown as Parameters<
          typeof persistBusinessInfoSettings
        >[0],
        'business-123',
        payload
      )
    ).rejects.toBe(databaseError);
  });
});
