import Link from "next/link";

export default function OnboardingPage() {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold text-gray-900">Onboarding Wizard</h1>
      <p className="mt-2 text-gray-600">Coming Soon</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block text-blue-600 hover:text-blue-700 font-medium"
      >
        Go to Dashboard →
      </Link>
    </div>
  );
}
