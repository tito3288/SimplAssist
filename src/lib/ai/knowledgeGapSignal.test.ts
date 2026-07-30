import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_GAP_SIGNAL,
  parseKnowledgeGapSignal,
  stripExactKnowledgeGapSignal,
} from "./knowledgeGapSignal";
import { countSmsParts } from "@/lib/billing/smsParts";

describe("parseKnowledgeGapSignal", () => {
  it("returns unmarked text byte-for-byte", () => {
    const response = "  First line\r\n\r\nSecond line.  ";

    expect(parseKnowledgeGapSignal(response)).toEqual({
      text: response,
      knowledgeGapDetected: false,
    });
  });

  it.each([
    {
      label: "start",
      response: `${KNOWLEDGE_GAP_SIGNAL}\nPlease call us.`,
      expected: "Please call us.",
    },
    {
      label: "middle",
      response: `I don't see trials mentioned. ${KNOWLEDGE_GAP_SIGNAL} Please call us.`,
      expected: "I don't see trials mentioned. Please call us.",
    },
    {
      label: "end",
      response: `I don't see trials mentioned.\n${KNOWLEDGE_GAP_SIGNAL}`,
      expected: "I don't see trials mentioned.",
    },
  ])("strips a signal at the $label", ({ response, expected }) => {
    expect(parseKnowledgeGapSignal(response)).toEqual({
      text: expected,
      knowledgeGapDetected: true,
    });
  });

  it("strips duplicate signals without leaving marker-only blank lines", () => {
    const response = [
      "I don't see trials mentioned.",
      "",
      KNOWLEDGE_GAP_SIGNAL,
      KNOWLEDGE_GAP_SIGNAL,
      "",
      "Please call us.",
    ].join("\n");

    expect(parseKnowledgeGapSignal(response)).toEqual({
      text: "I don't see trials mentioned.\n\nPlease call us.",
      knowledgeGapDetected: true,
    });
  });

  it.each([
    "[simplassist knowledge gap v1]",
    "[[[ SIMPLASSIST-KNOWLEDGE-GAP-V1 ]]]",
    "`SIMPLASSIST_KNOWLEDGE_GAP_V1`",
    "```[[SIMPLASSIST_KNOWLEDGE_GAP_V1]]]```",
  ])("tolerates a formatted or malformed inline marker: %s", (marker) => {
    expect(parseKnowledgeGapSignal(`Please call us.\n${marker}`)).toEqual({
      text: "Please call us.",
      knowledgeGapDetected: true,
    });
  });

  it("strips a marker wrapped in a multiline code fence without adding a blank line", () => {
    const response = [
      "I don't see trials mentioned.",
      "```text",
      KNOWLEDGE_GAP_SIGNAL,
      "```",
      "Please call us.",
    ].join("\n");
    const expected =
      "I don't see trials mentioned.\nPlease call us.";
    const parsed = parseKnowledgeGapSignal(response);

    expect(parsed).toEqual({
      text: expected,
      knowledgeGapDetected: true,
    });
    expect(countSmsParts(parsed.text)).toBe(countSmsParts(expected));
  });

  it.each([
    [
      "line-wrapped marker",
      [
        "Please call us.",
        "[[SIMPLASSIST_",
        "KNOWLEDGE_GAP_V1]]",
      ].join("\n"),
    ],
    [
      "unclosed opening fence",
      [
        "Please call us.",
        "```text",
        KNOWLEDGE_GAP_SIGNAL,
      ].join("\n"),
    ],
    [
      "unmatched closing fence",
      [
        "Please call us.",
        KNOWLEDGE_GAP_SIGNAL,
        "```",
      ].join("\n"),
    ],
    [
      "fence with internal blank lines",
      [
        "Please call us.",
        "```text",
        "",
        KNOWLEDGE_GAP_SIGNAL,
        "",
        "```",
      ].join("\n"),
    ],
    [
      "four-backtick fence",
      [
        "Please call us.",
        "````",
        KNOWLEDGE_GAP_SIGNAL,
        "````",
      ].join("\n"),
    ],
    [
      "four inline backticks",
      `Please call us.\n\`\`\`\`${KNOWLEDGE_GAP_SIGNAL}\`\`\`\``,
    ],
  ])("strips a %s without leaving wrapper debris", (_label, response) => {
    expect(parseKnowledgeGapSignal(response)).toEqual({
      text: "Please call us.",
      knowledgeGapDetected: true,
    });
  });

  it("reports a marker-only response with no customer-visible text", () => {
    expect(parseKnowledgeGapSignal(KNOWLEDGE_GAP_SIGNAL)).toEqual({
      text: "",
      knowledgeGapDetected: true,
    });
  });
});

describe("stripExactKnowledgeGapSignal", () => {
  it("removes every exact sentinel for the parser-failure fallback", () => {
    expect(
      stripExactKnowledgeGapSignal(
        `Please call us.\n${KNOWLEDGE_GAP_SIGNAL}${KNOWLEDGE_GAP_SIGNAL}`
      )
    ).toBe("Please call us.");
  });

  it("does not treat a case-variant marker as exact", () => {
    const variant = "[[simplassist_knowledge_gap_v1]]";

    expect(stripExactKnowledgeGapSignal(variant)).toBe(variant);
  });
});
