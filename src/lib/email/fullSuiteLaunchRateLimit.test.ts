import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("scheduleFullSuiteLaunchResend", () => {
  it("paces concurrent provider starts by 500 ms and does not charge cancelled preflight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00.000Z"));
    const { scheduleFullSuiteLaunchResend } = await import(
      "./fullSuiteLaunchRateLimit"
    );
    const starts: number[] = [];

    const first = scheduleFullSuiteLaunchResend(async () => {
      starts.push(Date.now());
      return "first";
    });
    const cancelled = scheduleFullSuiteLaunchResend(
      async () => {
        starts.push(Date.now());
        return "never";
      },
      async () => false
    );
    const third = scheduleFullSuiteLaunchResend(async () => {
      starts.push(Date.now());
      return "third";
    });
    const fourth = scheduleFullSuiteLaunchResend(async () => {
      starts.push(Date.now());
      return "fourth";
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([Date.parse("2026-07-30T12:00:00.000Z")]);

    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([
      Date.parse("2026-07-30T12:00:00.000Z"),
      Date.parse("2026-07-30T12:00:00.500Z"),
    ]);

    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([
      Date.parse("2026-07-30T12:00:00.000Z"),
      Date.parse("2026-07-30T12:00:00.500Z"),
      Date.parse("2026-07-30T12:00:01.000Z"),
    ]);

    await expect(first).resolves.toEqual({ started: true, value: "first" });
    await expect(cancelled).resolves.toEqual({ started: false });
    await expect(third).resolves.toEqual({ started: true, value: "third" });
    await expect(fourth).resolves.toEqual({ started: true, value: "fourth" });
  });
});
