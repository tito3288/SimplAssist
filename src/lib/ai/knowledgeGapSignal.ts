export const KNOWLEDGE_GAP_SIGNAL =
  "[[SIMPLASSIST_KNOWLEDGE_GAP_V1]]";

export interface ParsedKnowledgeGapSignal {
  text: string;
  knowledgeGapDetected: boolean;
}

const SIGNAL_SEPARATOR_SOURCE =
  String.raw`(?:[ \t_-]|\r?\n[ \t]*)+`;
const SIGNAL_CORE_SOURCE =
  String.raw`\[*[ \t]*\bSIMPLASSIST${SIGNAL_SEPARATOR_SOURCE}KNOWLEDGE${SIGNAL_SEPARATOR_SOURCE}GAP${SIGNAL_SEPARATOR_SOURCE}V(?:[ \t_-]|\r?\n[ \t]*)*1\b[ \t]*\]*`;
const INLINE_SIGNAL_SOURCE =
  String.raw`\`*[ \t]*${SIGNAL_CORE_SOURCE}[ \t]*\`*`;

function signalBlockPattern(): RegExp {
  return new RegExp(
    String.raw`(^|\r?\n)(?:[ \t]*\`{3,}[^\r\n]*(?:\r?\n)(?:[ \t]*\r?\n)*)?[ \t]*${SIGNAL_CORE_SOURCE}[ \t]*(?:(?:\r?\n)(?:[ \t]*\r?\n)*[ \t]*\`{3,}[ \t]*)?(?:\r?\n|$)`,
    "gim"
  );
}

function inlineSignalPattern(): RegExp {
  return new RegExp(INLINE_SIGNAL_SOURCE, "gi");
}

/**
 * Removes the model-only knowledge-gap marker from a customer response.
 *
 * An unmarked response is returned byte-for-byte so normal response formatting
 * is never changed. Marked responses tolerate harmless formatting drift around
 * the sentinel because model output is not guaranteed to reproduce punctuation
 * perfectly.
 */
export function parseKnowledgeGapSignal(
  responseText: string
): ParsedKnowledgeGapSignal {
  if (!inlineSignalPattern().test(responseText)) {
    return {
      text: responseText,
      knowledgeGapDetected: false,
    };
  }

  let cleaned = responseText.replace(
    signalBlockPattern(),
    (_match, leadingNewline: string) => leadingNewline
  );
  cleaned = cleaned.replace(
    inlineSignalPattern(),
    (
      match: string,
      offset: number,
      wholeResponse: string
    ): string => {
      const before = wholeResponse[offset - 1] ?? "";
      const after = wholeResponse[offset + match.length] ?? "";

      if (
        before &&
        after &&
        !/\s/.test(before) &&
        !/\s/.test(after) &&
        !/[.,!?;:)\]}]/.test(after)
      ) {
        return " ";
      }

      return "";
    }
  );

  cleaned = cleaned.replace(/[ \t]+(?=\r?\n|$)/g, "");
  cleaned = cleaned.replace(
    /(\r?\n)(?:[ \t]*\r?\n){2,}/g,
    (_match, newline: string) => `${newline}${newline}`
  );

  return {
    text: cleaned.trim(),
    knowledgeGapDetected: true,
  };
}

/**
 * Last-resort cleanup used only when the tolerant parser itself fails.
 * Classification intentionally remains false in that path.
 */
export function stripExactKnowledgeGapSignal(responseText: string): string {
  return responseText.split(KNOWLEDGE_GAP_SIGNAL).join("").trim();
}
