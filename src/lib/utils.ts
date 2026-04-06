import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import { nanoid } from "nanoid";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatDate(date: string | Date, formatStr: string = "PPp"): string {
  return format(new Date(date), formatStr);
}

export function generateId(size: number = 12): string {
  return nanoid(size);
}

/** First token of Supabase Auth `user_metadata.full_name`, title-cased, or null if missing. */
export function getFirstNameFromAuthMetadata(user: {
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const raw = user.user_metadata?.full_name;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const first = raw.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
