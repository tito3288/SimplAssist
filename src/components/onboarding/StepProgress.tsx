'use client';

const STEP_LABELS = [
  'Business Info',
  'Business Hours',
  'Services & FAQs',
  'AI Settings',
  'Business Verification',
  'SMS Use Case',
  'Phone Number',
  'Review & Submit',
  'Carrier Review',
];

const N = STEP_LABELS.length;

/**
 * Sliding-window math (see docs/step-progress-redesign-plan.md):
 * the window of `size` slots starts at current − floor(size/2), clamped so
 * the window never runs past either end of the step list.
 */
function windowStart(current: number, size: number): number {
  return Math.min(Math.max(current - Math.floor(size / 2), 1), N - size + 1);
}

interface StepProgressProps {
  currentStep: number;
}

export default function StepProgress({ currentStep }: StepProgressProps) {
  const safeStep = Math.min(Math.max(currentStep, 1), N);

  /**
   * One track per breakpoint (transform can't branch per media query).
   * All 9 steps stay mounted; the track translates by whole slots so
   * advancing is a single transform transition — nothing mounts mid-slide.
   */
  const renderTrack = (size: number, showAllLabels: boolean) => {
    const start = windowStart(safeStep, size);
    const end = start + size - 1;
    const leftHidden = start > 1;
    const rightHidden = end < N;

    // Feather the viewport edge only on sides that actually hide steps.
    const mask = `linear-gradient(to right, ${
      leftHidden ? 'transparent 0, black 24px' : 'black 0'
    }, ${rightHidden ? 'black calc(100% - 24px), transparent 100%' : 'black 100%'})`;

    return (
      <div
        className="overflow-hidden py-1"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div
          className="flex transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{
            width: `${(N / size) * 100}%`,
            transform: `translateX(-${((start - 1) * 100) / N}%)`,
          }}
        >
          {STEP_LABELS.map((label, i) => {
            const step = i + 1;
            const isPeek =
              (leftHidden && step === start) || (rightHidden && step === end);
            const completed = step < safeStep;
            const isCurrent = step === safeStep;

            return (
              <div
                key={label}
                className="flex flex-col items-center"
                style={{ width: `${100 / N}%` }}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 motion-reduce:transition-none ${
                    completed
                      ? 'bg-[#ea580c] dark:bg-[#ff914d] text-white dark:text-[#16100b]'
                      : isCurrent
                      ? 'bg-[#ea580c] dark:bg-[#ff914d] text-white dark:text-[#16100b]'
                      : 'bg-stone-200 dark:bg-white/[0.08] text-stone-500 dark:text-[#666]'
                  } ${isPeek ? 'opacity-45 scale-90' : 'opacity-100 scale-100'}`}
                >
                  {completed ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    step
                  )}
                </div>
                <span
                  className={`mt-1 w-full truncate px-1 text-center text-xs transition-[color,opacity] duration-300 motion-reduce:transition-none ${
                    step <= safeStep
                      ? 'text-[#c2410c] dark:text-[#ff914d] font-medium'
                      : 'text-stone-400 dark:text-[#666]'
                  } ${isPeek ? 'opacity-45' : 'opacity-100'} ${
                    showAllLabels || isCurrent ? '' : 'invisible'
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-stone-700 dark:text-[#d4d4d8]">
          Step {safeStep} of {STEP_LABELS.length}
        </span>
        <span className="text-sm text-stone-500 dark:text-[#bdbdbf]">{STEP_LABELS[safeStep - 1]}</span>
      </div>
      <div className="w-full bg-stone-200 dark:bg-white/[0.10] rounded-full h-2">
        <div
          className="bg-[#ea580c] dark:bg-[#ff914d] h-2 rounded-full transition-all duration-300"
          style={{ width: `${(safeStep / STEP_LABELS.length) * 100}%` }}
        />
      </div>

      {/* Windowed step dots — visual duplicate of the strip above, so hidden
          from screen readers; the text remains the canonical announcement. */}
      <div className="mt-3" aria-hidden="true">
        <div className="sm:hidden">{renderTrack(3, false)}</div>
        <div className="hidden sm:block">{renderTrack(5, true)}</div>
      </div>
    </div>
  );
}
