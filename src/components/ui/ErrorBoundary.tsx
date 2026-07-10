"use client";

import { Component, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { body, btnPrimary, btnSecondary, ink } from "@/lib/theme-v2/theme";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <h2 className={`text-xl font-semibold mb-2 ${ink}`}>Something went wrong</h2>
            <p className={`text-sm mb-6 ${body}`}>
              An unexpected error occurred. Please try again or return to the dashboard.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => this.setState({ hasError: false })}
                className={btnPrimary}
              >
                Try Again
              </button>
              <Link
                href="/dashboard"
                className={btnSecondary}
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
