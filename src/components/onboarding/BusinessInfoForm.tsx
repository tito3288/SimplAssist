'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { BusinessType } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';

const businessInfoSchema = z.object({
  name: z.string().min(1, 'Business name is required'),
  business_type: z.enum([
    'plumber', 'dentist', 'restaurant', 'car_wash', 'salon', 'hvac', 'auto_shop', 'general',
  ] as const),
  website: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  phone: z.string().min(10, 'Enter a valid phone number'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zip: z.string().min(5, 'Enter a valid zip code'),
});

type BusinessInfoData = z.infer<typeof businessInfoSchema>;

export interface ScrapedData {
  services?: { name: string; description?: string; price?: string }[];
  faqs?: { question: string; answer: string }[];
}

interface BusinessInfoFormProps {
  businessId: string;
  initialData?: Partial<BusinessInfoData>;
  onNext: (data: BusinessInfoData, scrapedData: ScrapedData | null) => void;
}

const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'plumber', label: 'Plumber' },
  { value: 'dentist', label: 'Dentist' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'car_wash', label: 'Car Wash' },
  { value: 'salon', label: 'Salon' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'auto_shop', label: 'Auto Shop' },
  { value: 'general', label: 'General' },
];

export default function BusinessInfoForm({ businessId, initialData, onNext }: BusinessInfoFormProps) {
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<BusinessInfoData>({
    resolver: zodResolver(businessInfoSchema),
    defaultValues: {
      name: initialData?.name || '',
      business_type: initialData?.business_type || 'general',
      website: initialData?.website || '',
      phone: initialData?.phone || '',
      address: initialData?.address || '',
      city: initialData?.city || '',
      state: initialData?.state || '',
      zip: initialData?.zip || '',
    },
  });

  const websiteValue = watch('website');

  const handleScanWebsite = async () => {
    if (!websiteValue) return;
    setScanning(true);
    setScanError('');
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteValue }),
      });
      if (!res.ok) throw new Error('Failed to scan website');
      const data = await res.json();
      setScrapedData(data);
    } catch {
      setScanError('Could not scan website. You can add services and FAQs manually.');
    } finally {
      setScanning(false);
    }
  };

  const onSubmit = async (data: BusinessInfoData) => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('businesses')
        .update({
          name: data.name,
          business_type: data.business_type,
          website_url: data.website || null,
          phone_number: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
        })
        .eq('id', businessId);
      if (error) throw error;
      onNext(data, scrapedData);
    } catch {
      // Error is shown via form state
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <h2 className="text-xl font-semibold text-gray-900">Tell us about your business</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
        <input
          {...register('name')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {errors.name && <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Business Type *</label>
        <select
          {...register('business_type')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {BUSINESS_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Website URL (optional)</label>
        <div className="flex gap-2">
          <input
            {...register('website')}
            placeholder="https://www.example.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {websiteValue && (
            <button
              type="button"
              onClick={handleScanWebsite}
              disabled={scanning}
              className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
            >
              {scanning ? (
                <span className="flex items-center gap-2.5">
                  <PulsingDot inline />
                  Scanning…
                </span>
              ) : (
                'Scan Website'
              )}
            </button>
          )}
        </div>
        {scanError && <p className="text-sm text-amber-600 mt-1">{scanError}</p>}
        {scrapedData && (
          <p className="text-sm text-green-600 mt-1">
            Website scanned! Found {scrapedData.services?.length || 0} services and {scrapedData.faqs?.length || 0} FAQs.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
        <input
          {...register('phone')}
          placeholder="(555) 123-4567"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {errors.phone && <p className="text-sm text-red-600 mt-1">{errors.phone.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
        <input
          {...register('address')}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {errors.address && <p className="text-sm text-red-600 mt-1">{errors.address.message}</p>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
          <input
            {...register('city')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.city && <p className="text-sm text-red-600 mt-1">{errors.city.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
          <input
            {...register('state')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.state && <p className="text-sm text-red-600 mt-1">{errors.state.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Zip *</label>
          <input
            {...register('zip')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.zip && <p className="text-sm text-red-600 mt-1">{errors.zip.message}</p>}
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 py-2 px-6 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? (
            <>
              <PulsingDot inline />
              Saving…
            </>
          ) : (
            'Next'
          )}
        </button>
      </div>
    </form>
  );
}
