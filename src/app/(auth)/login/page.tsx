"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  authInputClass,
  primaryCtaClass,
  textPrimary,
  textSecondary,
} from "@/lib/glass";
import { PulsingDot } from "@/components/ui/pulsing-dot";
import { AuthPasswordField } from "@/components/auth/auth-password-field";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

const labelClass =
  "mb-1.5 block text-sm font-medium text-slate-700 dark:text-[#d4d4d8]";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const supabase = createBrowserClient();

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

    // Invalidate the Router Cache so the dashboard layout re-fetches with the
    // new user's auth cookie instead of serving a previous session's render.
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <div>
      <h1 className={`text-center text-2xl font-bold tracking-tight ${textPrimary}`}>
        Log in
      </h1>
      <p className={`mt-1 text-center text-sm ${textSecondary}`}>
        Welcome back — pick up where you left off.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={authInputClass}
            placeholder="you@example.com"
          />
          {errors.email && (
            <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>

        <AuthPasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          placeholder="••••••••"
          registration={register("password")}
          error={errors.password?.message}
        />

        {error && (
          <div
            className="
              rounded-[22px] border border-red-200/80 bg-red-50/90 px-4 py-3
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
          className={primaryCtaClass}
        >
          {isSubmitting ? (
            <>
              <PulsingDot inline />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className={`mt-8 text-center text-sm ${textSecondary}`}>
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-semibold text-[#ff914d] hover:text-[#ffb07a] transition-colors"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
