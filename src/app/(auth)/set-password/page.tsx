import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import SetPasswordForm from "./SetPasswordForm";
import { requirePasswordSetupPageAccess } from "@/lib/customer/workspaceRouteResponse.server";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  noStore();
  const access = await requirePasswordSetupPageAccess();

  if (access.user.app_metadata?.must_set_password !== true) {
    redirect("/dashboard");
  }

  return <SetPasswordForm />;
}
