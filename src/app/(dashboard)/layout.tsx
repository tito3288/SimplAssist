import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import Sidebar from "./_components/sidebar";
import { pageShell, fontStack, lightAmbient, darkAmbient } from "@/lib/theme-v2/theme";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Dashboard unlocks only after SMS is actually ready: approved campaign plus
  // the active phone number assigned to that campaign.
  const { data: business } = await supabase
    .from("businesses")
    .select("id, website_url, deleted_at")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    redirect("/onboarding");
  }

  if (business.deleted_at) {
    redirect("/account-deleted");
  }

  const onboardingState = await getOnboardingStateForBusinessId(business.id);
  if (!onboardingState?.dashboardReady) {
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

      <Sidebar userEmail={user.email ?? ""} websiteUrl={business.website_url ?? null} />
      <main className="flex-1 bg-transparent px-4 pt-[4.75rem] pb-6 lg:pt-5 lg:pr-6 lg:pb-6 lg:pl-0 relative z-[1] min-w-0 lg:min-h-0 lg:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
