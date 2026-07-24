// Paths whose requests carry/refresh the admin session channel. Exact-or-
// prefix matching (not bare startsWith) so customer paths like
// "/administrators" can never ride the admin channel. Free of "server-only"
// so middleware can import it.
export function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}
