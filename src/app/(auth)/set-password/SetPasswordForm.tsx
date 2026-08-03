"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthPasswordFieldV2, LoadingDot } from "@/lib/theme-v2/ui";
import { body, btnPrimaryWide, ink } from "@/lib/theme-v2/theme";

const setPasswordSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SetPasswordValues = z.infer<typeof setPasswordSchema>;

export default function SetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
  });

  async function onSubmit(values: SetPasswordValues) {
    setError(null);

    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        setError(
          payload?.message ??
            "We could not set your password. Request a new setup link and try again.",
        );
        return;
      }

      router.refresh();
      router.replace("/onboarding");
    } catch {
      setError("We could not set your password. Please try again.");
    }
  }

  return (
    <div>
      <h1 className={`text-center text-2xl font-bold tracking-tight ${ink}`}>
        Create your password
      </h1>
      <p className={`mt-2 text-center text-sm leading-6 ${body}`}>
        Choose the password you&apos;ll use to sign in to this workspace.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
        <AuthPasswordFieldV2
          id="password"
          label="Password"
          autoComplete="new-password"
          registration={register("password")}
          error={errors.password?.message}
        />
        <AuthPasswordFieldV2
          id="confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          registration={register("confirmPassword")}
          error={errors.confirmPassword?.message}
        />

        {error && (
          <div
            className="rounded-2xl border border-red-200/80 bg-red-50/90 px-4 py-3 dark:border-red-500/25 dark:bg-red-500/10"
            role="alert"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={btnPrimaryWide}
        >
          {isSubmitting ? (
            <>
              <LoadingDot />
              Saving password…
            </>
          ) : (
            "Set password"
          )}
        </button>
      </form>
    </div>
  );
}
