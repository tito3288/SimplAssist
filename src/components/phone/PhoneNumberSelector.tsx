"use client";

import { useState } from "react";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
}

interface PurchasedNumber {
  phone_number: string;
}

interface PhoneNumberSelectorProps {
  onConsentChange?: (agreed: boolean) => void;
}

export default function PhoneNumberSelector({ onConsentChange }: PhoneNumberSelectorProps) {
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<PurchasedNumber | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);

  function handleConsentToggle(checked: boolean) {
    setConsented(checked);
    onConsentChange?.(checked);
  }

  async function handleSearch() {
    if (!/^\d{3}$/.test(areaCode)) {
      setError("Please enter a valid 3-digit area code");
      return;
    }

    setError(null);
    setSearching(true);
    setNumbers([]);
    setPurchased(null);

    try {
      const res = await fetch(
        `/api/messaging/numbers/search?areaCode=${areaCode}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to search numbers");
        return;
      }

      setNumbers(data.numbers);
      if (data.numbers.length === 0) {
        setError("No numbers available for this area code");
      }
    } catch {
      setError("Failed to search numbers");
    } finally {
      setSearching(false);
    }
  }

  async function handlePurchase(phoneNumber: string) {
    setPurchasing(phoneNumber);
    setError(null);

    try {
      const res = await fetch("/api/messaging/numbers/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to purchase number");
        return;
      }

      setPurchased(data.number);
      setNumbers([]);
    } catch {
      setError("Failed to purchase number");
    } finally {
      setPurchasing(null);
    }
  }

  if (purchased) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <h3 className="text-lg font-semibold text-green-800">
          Number Purchased!
        </h3>
        <p className="mt-2 text-2xl font-bold text-green-900">
          {purchased.phone_number}
        </p>
        <p className="mt-1 text-sm text-green-600">
          Your new number is ready to receive messages.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* SMS Consent Checkbox — must agree before searching */}
      <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-white/[0.10] bg-slate-50 dark:bg-white/[0.04] cursor-pointer">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => handleConsentToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded accent-[#ff914d] flex-shrink-0"
        />
        <span className="text-sm text-slate-600 dark:text-[#bdbdbf] leading-relaxed">
          By selecting a phone number, I agree that SimplAssist will send automated text messages
          to customers who contact my business. I will not use this number for spam or unsolicited
          marketing. Customers can opt out at any time by replying STOP. I agree to SimplAssist&apos;s{" "}
          <a href="/terms" target="_blank" className="text-[#ff914d] underline hover:text-[#ffb07a]">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" target="_blank" className="text-[#ff914d] underline hover:text-[#ffb07a]">
            Privacy Policy
          </a>.
        </span>
      </label>

      {/* Search area — disabled until consented */}
      <div className={`flex gap-3 transition-opacity ${!consented ? "opacity-50 pointer-events-none" : ""}`}>
        <input
          type="text"
          value={areaCode}
          onChange={(e) =>
            setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
          }
          placeholder="Area code (e.g. 415)"
          disabled={!consented}
          className="w-40 rounded-md border border-gray-300 dark:border-white/[0.12] px-3 py-2 text-sm dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] focus:border-[#ff914d] focus:outline-none focus:ring-1 focus:ring-[#ff914d] disabled:cursor-not-allowed"
          maxLength={3}
        />
        <button
          onClick={handleSearch}
          disabled={!consented || searching || areaCode.length !== 3}
          className="rounded-md bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] px-4 py-2 text-sm font-medium text-white dark:text-[#111] shadow-[0_14px_34px_rgba(255,145,77,.26)] hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {numbers.length > 0 && (
        <ul className="divide-y divide-gray-200 dark:divide-white/[0.10] rounded-md border border-gray-200 dark:border-white/[0.10]">
          {numbers.map((n) => (
            <li
              key={n.phoneNumber}
              className="flex items-center justify-between px-4 py-3 dark:hover:bg-white/[0.04]"
            >
              <div>
                <p className="font-medium text-slate-900 dark:text-[#f5f5f5]">{n.phoneNumber}</p>
                <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">{n.friendlyName}</p>
              </div>
              <button
                onClick={() => handlePurchase(n.phoneNumber)}
                disabled={purchasing !== null}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {purchasing === n.phoneNumber ? "Purchasing..." : "Select"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
