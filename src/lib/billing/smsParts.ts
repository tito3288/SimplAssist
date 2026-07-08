const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ" +
  " !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`¿abcdefghijklmnopqrstuvwxyzäöñüà";

const GSM_EXTENDED = "^{}\\[~]|€";

const GSM_BASIC_SET = new Set(Array.from(GSM_BASIC));
const GSM_EXTENDED_SET = new Set(Array.from(GSM_EXTENDED));

export function countSmsParts(text: string): number {
  if (!text) return 0;

  const gsmSeptets = countGsmSeptets(text);
  if (gsmSeptets !== null) {
    return gsmSeptets <= 160 ? 1 : Math.ceil(gsmSeptets / 153);
  }

  const codePoints = Array.from(text).length;
  return codePoints <= 70 ? 1 : Math.ceil(codePoints / 67);
}

function countGsmSeptets(text: string): number | null {
  let count = 0;
  for (const char of text) {
    if (GSM_BASIC_SET.has(char)) {
      count += 1;
    } else if (GSM_EXTENDED_SET.has(char)) {
      count += 2;
    } else {
      return null;
    }
  }
  return count;
}
