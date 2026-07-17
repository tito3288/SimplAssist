"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import {
  body,
  btnPrimaryWide,
  fieldLabel,
  ink,
  inputField,
} from "@/lib/theme-v2/theme";
import { LoadingDot } from "@/lib/theme-v2/ui";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_VALUES,
  type SupportCategory,
} from "@/lib/support/constants";

/**
 * Support ticket form. Mirrors the /api/support schema; identity fields are
 * prefill conveniences only — the API derives user/business from the session.
 * The `website` field is a honeypot: rendered off-screen (not display:none —
 * some bots skip hidden subtrees), never filled by humans.
 */

const supportFormSchema = z.object({
  category: z.enum(SUPPORT_CATEGORY_VALUES, { message: "Please choose a topic" }),
  message: z
    .string()
    .trim()
    .min(10, "Please tell us a bit more about what you need")
    .max(5000, "Please keep your message under 5,000 characters"),
  name: z.string().trim().min(1, "Please enter your name").max(200),
  email: z.string().trim().email("Please enter a valid email").max(320),
  website: z.string().optional(),
});

type SupportFormValues = z.infer<typeof supportFormSchema>;

export function SupportForm({
  defaultName,
  defaultEmail,
  defaultCategory,
}: {
  defaultName: string;
  defaultEmail: string;
  defaultCategory?: SupportCategory;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SupportFormValues>({
    resolver: zodResolver(supportFormSchema),
    defaultValues: {
      name: defaultName,
      email: defaultEmail,
      category: defaultCategory,
      message: "",
      website: "",
    },
  });

  async function onSubmit(data: SupportFormValues) {
    setError(null);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(
          payload?.error ?? "Couldn't submit your request. Please try again."
        );
        return;
      }

      setSubmittedEmail(data.email);
    } catch {
      setError("Couldn't submit your request. Please try again.");
    }
  }

  if (submittedEmail) {
    return (
      <div
        className="rounded-2xl border border-green-200 bg-green-50 px-5 py-6 dark:border-[rgba(74,222,128,0.25)] dark:bg-[rgba(74,222,128,0.10)]"
        role="status"
      >
        <p className={`flex items-center gap-2.5 font-semibold ${ink}`}>
          <CheckCircle2
            className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
            aria-hidden
          />
          Thanks — we got your message.
        </p>
        <p className={`mt-1.5 text-sm ${body}`}>
          We&apos;ll reply to <span className="font-medium">{submittedEmail}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div>
        <label htmlFor="support-category" className={fieldLabel}>
          What do you need help with?
        </label>
        <select
          id="support-category"
          {...register("category")}
          className={inputField}
          defaultValue={defaultCategory ?? ""}
        >
          <option value="" disabled>
            Choose a topic
          </option>
          {SUPPORT_CATEGORIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.category && (
          <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
            {errors.category.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="support-message" className={fieldLabel}>
          Message
        </label>
        <textarea
          id="support-message"
          rows={6}
          {...register("message")}
          className={`${inputField} min-h-40 resize-y`}
          placeholder="Tell us what's going on…"
        />
        {errors.message && (
          <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
            {errors.message.message}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="support-name" className={fieldLabel}>
            Your name
          </label>
          <input
            id="support-name"
            type="text"
            autoComplete="name"
            {...register("name")}
            className={inputField}
            placeholder="Jane Smith"
          />
          {errors.name && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
              {errors.name.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="support-email" className={fieldLabel}>
            Email
          </label>
          <input
            id="support-email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={inputField}
            placeholder="you@example.com"
          />
          {errors.email && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>
      </div>

      {/* Honeypot — off-screen, never display:none */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        {...register("website")}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      {error && (
        <div
          className="
            rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3
            dark:border-red-500/25 dark:bg-red-500/10
          "
          role="alert"
        >
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <button type="submit" disabled={isSubmitting} className={btnPrimaryWide}>
        {isSubmitting ? (
          <>
            <LoadingDot />
            Sending…
          </>
        ) : (
          "Send message"
        )}
      </button>
    </form>
  );
}
