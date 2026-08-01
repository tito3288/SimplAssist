import { PRIVATE_ROUTE_METADATA } from "@/lib/seo/privateMetadata";

export const metadata = PRIVATE_ROUTE_METADATA;

export default function WidgetPreviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
