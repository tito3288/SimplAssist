'use client';

const STEP_LABELS = [
  'Business Info',
  'Business Hours',
  'Services & FAQs',
  'AI Personality',
  'Review & Launch',
];

interface StepProgressProps {
  currentStep: number;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Step {currentStep} of {STEP_LABELS.length}
        </span>
        <span className="text-sm text-gray-500">{STEP_LABELS[currentStep - 1]}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${(currentStep / STEP_LABELS.length) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-3">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                i + 1 < currentStep
                  ? 'bg-blue-600 text-white'
                  : i + 1 === currentStep
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1 < currentStep ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs mt-1 hidden sm:block ${
              i + 1 <= currentStep ? 'text-blue-600 font-medium' : 'text-gray-400'
            }`}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
