import HomePage from "./(public)/home/page";
import { getHomepageMetadata } from "./(public)/home/seo";
import { isChatOnlyPublicLaunchEnabled } from "@/lib/billing/chatOnlyPublicLaunch.server";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function generateMetadata() {
  return getHomepageMetadata(isChatOnlyPublicLaunchEnabled());
}

export default async function Page() {
  const requestBrand = await getRequestBrand();

  if (requestBrand.source === "partner_host") {
    redirect("/login");
  }

  return (
    <HomePage
      chatOnlyPublicLaunchEnabled={isChatOnlyPublicLaunchEnabled()}
    />
  );
}
