export function nextCalendarMutationOperationId(
  currentOperationId: string,
  previousPayloadKey: string | null,
  nextPayloadKey: string,
  createOperationId: () => string = () => globalThis.crypto.randomUUID()
): string {
  if (
    !currentOperationId ||
    (previousPayloadKey !== null && previousPayloadKey !== nextPayloadKey)
  ) {
    return createOperationId();
  }
  return currentOperationId;
}
