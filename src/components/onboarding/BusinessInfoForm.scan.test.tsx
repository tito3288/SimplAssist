import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import BusinessInfoForm from './BusinessInfoForm';

const initialData = {
  name: '',
  business_type: 'general' as const,
  website: 'https://example.com',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

describe('BusinessInfoForm website scan rollout', () => {
  it('keeps the legacy scanner available when the richer scan is disabled', () => {
    const markup = renderToStaticMarkup(
      <BusinessInfoForm
        businessId="00000000-0000-4000-8000-000000000001"
        initialData={initialData}
        richerScanEnabled={false}
        onNext={vi.fn()}
      />
    );

    expect(markup).toContain('Scan Website');
    expect(markup).not.toContain('Checking for an existing scan');
  });

  it('uses the persisted richer-scan controller when enabled', () => {
    const markup = renderToStaticMarkup(
      <BusinessInfoForm
        businessId="00000000-0000-4000-8000-000000000001"
        initialData={initialData}
        richerScanEnabled
        onNext={vi.fn()}
      />
    );

    expect(markup).toContain('Checking for an existing scan');
    expect(markup).not.toContain('>Scan Website<');
  });
});
