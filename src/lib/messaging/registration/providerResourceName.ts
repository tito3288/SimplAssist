export const TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES = 64;

const TRUNCATION_MARKER = "...";
const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

/**
 * Build the human-readable Telnyx resource name used by profile/application
 * creation. The business-id suffix is the recovery key and must remain exact.
 */
export function buildProviderResourceName(
  leadingName: string,
  businessId: string
): string {
  const sacredSuffix = `(${businessId})`;
  const separatorAndSuffix = ` ${sacredSuffix}`;
  const originalName = `${leadingName}${separatorAndSuffix}`;

  if (utf8ByteLength(originalName) <= TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES) {
    return originalName;
  }

  const reservedBytes =
    utf8ByteLength(TRUNCATION_MARKER) + utf8ByteLength(separatorAndSuffix);
  const leadingByteBudget =
    TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES - reservedBytes;

  if (leadingByteBudget < 0) {
    throw new Error(
      `[registration:providerResourceName] Business id suffix cannot fit within ${TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES} UTF-8 bytes`
    );
  }

  let retainedLeadingName = "";
  let retainedBytes = 0;
  for (const character of leadingName) {
    const characterBytes = utf8ByteLength(character);
    if (retainedBytes + characterBytes > leadingByteBudget) break;
    retainedLeadingName += character;
    retainedBytes += characterBytes;
  }

  const providerResourceName = `${retainedLeadingName.trimEnd()}${TRUNCATION_MARKER}${separatorAndSuffix}`;
  if (
    utf8ByteLength(providerResourceName) >
      TELNYX_PROVIDER_RESOURCE_NAME_MAX_BYTES ||
    !providerResourceName.endsWith(sacredSuffix)
  ) {
    throw new Error(
      "[registration:providerResourceName] Generated provider resource name violated its length or suffix invariant"
    );
  }

  return providerResourceName;
}
