"use client";

import { useState } from "react";

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
}

interface PurchasedNumber {
  id: string;
  phone_number: string;
  twilio_sid: string;
  is_active: boolean;
}

export default function PhoneNumberSelector() {
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<PurchasedNumber | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        `/api/twilio/numbers/search?areaCode=${areaCode}`
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
      const res = await fetch("/api/twilio/numbers/purchase", {
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
      <div className="flex gap-3">
        <input
          type="text"
          value={areaCode}
          onChange={(e) =>
            setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))
          }
          placeholder="Area code (e.g. 415)"
          className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          maxLength={3}
        />
        <button
          onClick={handleSearch}
          disabled={searching || areaCode.length !== 3}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {numbers.length > 0 && (
        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
          {numbers.map((n) => (
            <li
              key={n.phoneNumber}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <p className="font-medium text-gray-900">{n.phoneNumber}</p>
                <p className="text-sm text-gray-500">{n.friendlyName}</p>
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
