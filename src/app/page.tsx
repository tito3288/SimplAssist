import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStateForOwner } from "@/lib/onboarding/state";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/home");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("deleted_at")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    redirect("/onboarding");
  }

  if (business.deleted_at) {
    redirect("/account-deleted");
  }

  const onboardingState = await getOnboardingStateForOwner(user.id);
  if (!onboardingState?.dashboardReady) {
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
