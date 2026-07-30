import "server-only";

const RESEND_MINIMUM_INTERVAL_MS = 500;

let launchSendQueue: Promise<void> = Promise.resolve();
let nextLaunchSendAt = 0;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serialize Full Suite launch-email requests and leave at least 500 ms
 * between provider request starts. This covers test, single, and bulk sends
 * handled by the same server process.
 */
export type ScheduledLaunchResend<T> =
  | { started: false }
  | { started: true; value: T };

export function scheduleFullSuiteLaunchResend<T>(
  operation: () => Promise<T>,
  beforeStart?: () => Promise<boolean>
): Promise<ScheduledLaunchResend<T>> {
  const scheduled = launchSendQueue.then(async () => {
    const delay = Math.max(0, nextLaunchSendAt - Date.now());
    if (delay > 0) await wait(delay);

    // The claim/unsubscribe check happens after pacing and immediately before
    // the provider call. A skipped recipient neither calls Resend nor consumes
    // a rate slot.
    if (beforeStart && !(await beforeStart())) {
      return { started: false } as const;
    }

    nextLaunchSendAt = Date.now() + RESEND_MINIMUM_INTERVAL_MS;
    return {
      started: true,
      value: await operation(),
    } as const;
  });

  launchSendQueue = scheduled.then(
    () => undefined,
    () => undefined
  );

  return scheduled;
}
