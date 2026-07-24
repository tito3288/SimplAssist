// Parses SIMPLASSIST_ADMIN_USER_IDS. Fail-closed: unset/empty/whitespace-only
// yields an empty set, meaning nobody is admin. Kept free of "server-only"
// and next/headers so middleware can import it; only server code uses it.
export function adminUserIds(): Set<string> {
  const raw = process.env.SIMPLASSIST_ADMIN_USER_IDS;
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}
