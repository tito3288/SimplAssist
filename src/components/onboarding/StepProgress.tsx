'use client';

const STEP_LABELS = [
  'Business Info',
  'Business Hours',
  'Services & FAQs',
  'AI Personality',
  'Phone Number',
  'Review & Launch',
];

interface StepProgressProps {
  currentStep: number;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700 dark:text-[#d4d4d8]">
          Step {currentStep} of {STEP_LABELS.length}
        </span>
        <span className="text-sm text-slate-500 dark:text-[#bdbdbf]">{STEP_LABELS[currentStep - 1]}</span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-white/[0.08] rounded-full h-2">
        <div
          className="bg-[#ff914d] h-2 rounded-full transition-all duration-300"
          style={{ width: `${(currentStep / STEP_LABELS.length) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-3">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                i + 1 < currentStep
                  ? 'bg-[#ff914d] text-white'
                  : i + 1 === currentStep
                  ? 'bg-[#ff914d] text-white ring-4 ring-[rgba(255,145,77,.25)]'
                  : 'bg-slate-200 dark:bg-white/[0.08] text-slate-500 dark:text-[#666]'
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
              i + 1 <= currentStep ? 'text-[#ff914d] font-medium' : 'text-slate-400 dark:text-[#666]'
            }`}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
