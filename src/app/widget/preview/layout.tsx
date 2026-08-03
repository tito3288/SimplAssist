import { redirect } from "next/navigation";
import { getWorkspaceAccess } from "@/lib/customer/workspaceAccess.server";
import { workspacePageRedirectTarget } from "@/lib/customer/workspaceRouteResponse.server";
import { PRIVATE_ROUTE_METADATA } from "@/lib/seo/privateMetadata";

export const metadata = PRIVATE_ROUTE_METADATA;

export default async function WidgetPreviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const workspaceAccess = await getWorkspaceAccess();
  const workspaceRedirect = workspacePageRedirectTarget(workspaceAccess);
  if (workspaceRedirect) {
    redirect(workspaceRedirect);
  }

  return children;
}
