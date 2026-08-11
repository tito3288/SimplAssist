import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PrimaryGoal } from "@/types/database";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import {
  PRIMARY_GOAL_COPY,
  buildPrimaryGoalUpdate,
} from "@/lib/goals/primaryGoal";
import GoalSettingsForm, {
  reduceGoalSettingsDraft,
  saveGoalSettings,
} from "./GoalSettingsForm";

function renderForm(
  initialPrimaryGoal: PrimaryGoal | null,
  initialGoalUrl: string | null = null
): string {
  return renderToStaticMarkup(
    <GoalSettingsForm
      businessId="business-1"
      initialPrimaryGoal={initialPrimaryGoal}
      initialGoalUrl={initialGoalUrl}
    />
  );
}

function renderedCopy(value: string): string {
  return renderToStaticMarkup(<>{value}</>);
}

function primaryGoalInput(markup: string, value: "book" | "signup") {
  return (markup.match(/<input\b[^>]*>/g) ?? []).find(
    (input) =>
      input.includes('name="primary_goal"') &&
      input.includes(`value="${value}"`)
  );
}

function submitButton(markup: string): string {
  const button = (markup.match(/<button\b[^>]*>/g) ?? []).find((candidate) =>
    candidate.includes('type="submit"')
  );
  if (!button) throw new Error("missing submit button");
  return button;
}

type SaveClient = Parameters<typeof saveGoalSettings>[0]["supabase"];

function makeSaveClient(error: { message: string } | null = null) {
  const events: string[] = [];
  const from = vi.fn((table: string) => {
    events.push(`from:${table}`);
    return {
      update: vi.fn(() => {
        events.push("update");
        return {
          eq: vi.fn(async (column: string, value: string) => {
            events.push(`eq:${column}:${value}`);
            return { error };
          }),
        };
      }),
    };
  });

  return {
    client: { from } as unknown as SaveClient,
    from,
    events,
  };
}

describe("GoalSettingsForm", () => {
  it("renders the exact shared copy in order with only the v1 options", () => {
    const markup = renderForm(null);
    const copy = [
      PRIMARY_GOAL_COPY.question,
      PRIMARY_GOAL_COPY.options.book,
      PRIMARY_GOAL_COPY.options.signup,
      PRIMARY_GOAL_COPY.helper,
    ].map(renderedCopy);
    const positions = copy.map((value) => markup.indexOf(value));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(markup.match(/name="primary_goal"/g)).toHaveLength(2);
    expect(markup).not.toContain("quote");
    expect(markup).not.toContain("callback");
    expect(markup).toContain("Save Settings");
  });

  it.each([
    ["book", "book"],
    ["signup", "signup"],
  ] as const)("rehydrates only the stored %s selection", (goal, selected) => {
    const markup = renderForm(goal, "https://example.com/signup");
    const other = selected === "book" ? "signup" : "book";

    expect(primaryGoalInput(markup, selected)).toContain('checked=""');
    expect(primaryGoalInput(markup, other)).not.toContain('checked=""');
  });

  it("shows goal_url only for signup", () => {
    expect(renderForm("book", "https://example.com/retained")).not.toContain(
      'name="goal_url"'
    );
    expect(renderForm("signup", "https://example.com/signup")).toContain(
      'value="https://example.com/signup"'
    );
  });

  it.each([null, "quote", "callback"] as const)(
    "leaves initial goal %s unselected and performs no automatic write",
    (goal) => {
      mocks.createClient.mockClear();
      const markup = renderForm(goal, "https://example.com/retained");

      expect(primaryGoalInput(markup, "book")).not.toContain('checked=""');
      expect(primaryGoalInput(markup, "signup")).not.toContain('checked=""');
      expect(submitButton(markup)).toContain('disabled=""');
      expect(mocks.createClient).not.toHaveBeenCalled();
    }
  );

  it.each([
    "",
    "   ",
    "http://example.com",
    "HTTP://example.com",
    "https://",
    "https:///path",
    "not a url",
    "https://example.com/a path",
    `https://example.com/${"a".repeat(2030)}`,
  ])("blocks Save Settings for invalid signup URL %s", (goalUrl) => {
    expect(submitButton(renderForm("signup", goalUrl))).toContain(
      'disabled=""'
    );
  });

  it.each([
    "https://a",
    "https://Example.COM/Path?Camp=Summer#SignUp",
    "HTTPS://Example.COM/Path?Camp=Summer#SignUp",
    "HttpS://example.com/Class?Program=Fall#Register",
    "  https://example.com/SignUp?Source=AI#Form  ",
  ])("enables Save Settings for valid signup URL %s", (goalUrl) => {
    expect(submitButton(renderForm("signup", goalUrl))).not.toContain(
      'disabled=""'
    );
  });

  it("retains the initial URL while switching to book and back to signup", () => {
    const initial = {
      primaryGoal: "signup" as const,
      goalUrl: "https://example.com/retained",
    };
    const book = reduceGoalSettingsDraft(initial, {
      type: "primary_goal",
      value: "book",
    });
    const signup = reduceGoalSettingsDraft(book, {
      type: "primary_goal",
      value: "signup",
    });

    expect(book).toEqual({
      primaryGoal: "book",
      goalUrl: "https://example.com/retained",
    });
    expect(signup).toEqual(initial);
  });
});

describe("saveGoalSettings", () => {
  it("performs one signup business write with both fields, then refreshes", async () => {
    const writes = makeSaveClient();
    const payload = buildPrimaryGoalUpdate({
      primary_goal: "signup",
      goal_url: "  HttpS://example.com/Path?Camp=Summer#SignUp  ",
    });
    if (!payload) throw new Error("missing payload");
    const refresh = vi.fn(() => writes.events.push("refresh"));

    await saveGoalSettings({
      supabase: writes.client,
      businessId: "business-1",
      payload,
      refresh,
    });

    expect(writes.from).toHaveBeenCalledExactlyOnceWith("businesses");
    const update = writes.from.mock.results[0]?.value.update;
    expect(update).toHaveBeenCalledExactlyOnceWith({
      primary_goal: "signup",
      goal_url: "https://example.com/Path?Camp=Summer#SignUp",
    });
    expect(writes.events).toEqual([
      "from:businesses",
      "update",
      "eq:id:business-1",
      "refresh",
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("writes book without goal_url", async () => {
    const writes = makeSaveClient();
    const payload = buildPrimaryGoalUpdate({
      primary_goal: "book",
      goal_url: "https://example.com/retained",
    });
    if (!payload) throw new Error("missing payload");

    await saveGoalSettings({
      supabase: writes.client,
      businessId: "business-2",
      payload,
      refresh: vi.fn(),
    });

    const update = writes.from.mock.results[0]?.value.update;
    expect(update).toHaveBeenCalledExactlyOnceWith({ primary_goal: "book" });
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty("goal_url");
    expect(writes.events).toContain("eq:id:business-2");
  });

  it("does not refresh when the business write fails", async () => {
    const writes = makeSaveClient({ message: "failed" });
    const refresh = vi.fn();

    await expect(
      saveGoalSettings({
        supabase: writes.client,
        businessId: "business-1",
        payload: { primary_goal: "book" },
        refresh,
      })
    ).rejects.toEqual({ message: "failed" });

    expect(refresh).not.toHaveBeenCalled();
  });
});
