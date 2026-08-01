import { redirect } from "next/navigation";
import { getSmsReadinessForBusiness } from "@/lib/messaging/lookup";
import Sidebar from "./_components/sidebar";
import { pageShell, fontStack, lightAmbient, darkAmbient } from "@/lib/theme-v2/theme";
import { canUseFeature } from "@/lib/billing/entitlements";
import {
  getDashboardBusinessContext,
  getDashboardEntitlements,
} from "@/lib/dashboard/context";
import { PRIVATE_ROUTE_METADATA } from "@/lib/seo/privateMetadata";

export const metadata = PRIVATE_ROUTE_METADATA;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await getDashboardBusinessContext();
  if (context.status === "unauthenticated") {
    redirect("/login");
  }
  if (context.status !== "resolved") {
    redirect("/onboarding");
  }

  const { business, user } = context;
  if (business.deleted_at) {
    redirect("/account-deleted");
  }

  // Dashboard unlocks only after SMS is actually ready: approved campaign plus
  // the active phone number assigned to that campaign.
  const [smsReadiness, entitlements] = await Promise.all([
    getSmsReadinessForBusiness(business.id),
    getDashboardEntitlements(business.id),
  ]);
  if (!smsReadiness.smsReady) {
    redirect("/onboarding");
  }

  return (
    <div
      className={`${pageShell} isolate flex flex-col lg:flex-row lg:p-5 lg:gap-5`}
      style={{ fontFamily: fontStack }}
    >
      {/* Ambient backgrounds — light gets its own warm treatment */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="hidden dark:block fixed inset-0 pointer-events-none -z-10"
        style={{ background: darkAmbient }}
      />

      {/* Decorative orbs */}
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-30 dark:opacity-45"
        style={{
          width: 640,
          height: 640,
          background: "rgba(255,145,77,.20)",
          top: -70,
          right: -210,
          filter: "blur(60px)",
        }}
      />
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-20 dark:opacity-45"
        style={{
          width: 260,
          height: 260,
          background: "rgba(255,145,77,.14)",
          left: -80,
          top: "40%",
          filter: "blur(60px)",
        }}
      />

      <Sidebar
        userEmail={user.email ?? ""}
        websiteUrl={business.website_url ?? null}
        canUseCalendar={canUseFeature(entitlements, "calendar")}
        canUseWidget={canUseFeature(entitlements, "web_chat")}
      />
      <main className="flex-1 bg-transparent px-4 pt-[4.75rem] pb-6 lg:pt-5 lg:pr-6 lg:pb-6 lg:pl-0 relative z-[1] min-w-0 lg:min-h-0 lg:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
