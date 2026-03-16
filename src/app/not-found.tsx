import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-4xl font-bold text-gray-900">404</h1>
      <p className="mt-2 text-gray-600">Page not found</p>
      <Link
        href="/dashboard"
        className="mt-6 text-blue-600 hover:text-blue-700 font-medium"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
