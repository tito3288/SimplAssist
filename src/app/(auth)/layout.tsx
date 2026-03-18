import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-4">
          <Link href="/home" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </div>
        <div className="text-center mb-8">
          <Link href="/home" className="text-2xl font-bold text-slate-900">
            SimplAssist
          </Link>
          <p className="text-sm text-slate-500 mt-2">
            AI-powered customer communication for small businesses
          </p>
          <Link
            href="/home"
            className="text-xs text-blue-600 hover:text-blue-700 mt-1 inline-block"
          >
            Learn more
          </Link>
        </div>
        <div className="bg-white rounded-xl shadow-lg p-8">
          {children}
        </div>
      </div>
    </div>
  );

}
