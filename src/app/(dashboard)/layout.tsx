import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "./_components/sidebar";

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

  // Check if user has completed onboarding
  const { data: business } = await supabase
    .from("businesses")
    .select("business_type")
    .eq("owner_id", user.id)
    .single();

  if (!business || business.business_type === "general") {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar userEmail={user.email ?? ""} />
      <main className="flex-1 bg-gray-50 p-6 lg:p-8">{children}</main>
    </div>
  );
}
