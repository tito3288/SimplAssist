"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createAdminSessionBrowserClient } from "@/lib/admin/sessionClient";
import {
  body,
  btnPrimaryWide,
  fieldLabel,
  ink,
  inputField,
} from "@/lib/theme-v2/theme";
import { AuthPasswordFieldV2, LoadingDot } from "@/lib/theme-v2/ui";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

// Signs into the ADMIN session channel (sa-admin-auth cookies) — the
// customer session in this browser is untouched. On success, refresh alone
// re-runs the admin layout with the new cookie, rendering whichever /admin
// page was originally requested; a non-allowlisted sign-in is revoked by
// middleware on that refresh and this form simply renders again.
export default function AdminLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const supabase = createAdminSessionBrowserClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginForm) {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      setError(error.message);
      return;
    }

    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-sm py-16">
      <h1 className={`text-center text-2xl font-bold tracking-tight ${ink}`}>
        Admin sign in
      </h1>
      <p className={`mt-1 text-center text-sm ${body}`}>
        SimplAssist staff only.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
        <div>
          <label htmlFor="admin-email" className={fieldLabel}>
            Email
          </label>
          <input
            id="admin-email"
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

        <AuthPasswordFieldV2
          id="admin-password"
          label="Password"
          autoComplete="current-password"
          placeholder="••••••••"
          registration={register("password")}
          error={errors.password?.message}
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

        <button
          type="submit"
          disabled={isSubmitting}
          className={btnPrimaryWide}
        >
          {isSubmitting ? (
            <>
              <LoadingDot />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
    </div>
  );
}
