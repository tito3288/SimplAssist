import HomePage from "./(public)/home/page";
import { HOME_METADATA } from "./(public)/home/seo";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";
import { redirect } from "next/navigation";

export const metadata = HOME_METADATA;

export default async function Page() {
  const requestBrand = await getRequestBrand();

  if (requestBrand.source === "partner_host") {
    redirect("/login");
  }

  return <HomePage />;
}
