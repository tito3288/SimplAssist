import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReactivationCard from "@/components/account/ReactivationCard";
import { getWorkspaceAccess } from "@/lib/customer/workspaceAccess.server";
import { workspacePageRedirectTarget } from "@/lib/customer/workspaceRouteResponse.server";

export default async function AccountDeletedPage() {
  const workspaceAccess = await getWorkspaceAccess();
  const workspaceRedirect = workspacePageRedirectTarget(workspaceAccess);
  if (workspaceRedirect) {
    redirect(workspaceRedirect);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("deleted_at, deletion_scheduled_for")
    .eq("owner_id", user.id)
    .single();

  // If account is not deleted, send them to dashboard
  if (!business || !business.deleted_at) {
    redirect("/dashboard");
  }

  return (
    <ReactivationCard
      deletionDate={business.deletion_scheduled_for}
    />
  );
}
