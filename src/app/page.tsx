import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
    .select("business_type, deleted_at")
    .eq("owner_id", user.id)
    .single();

  if (!business || business.business_type === "general") {
    redirect("/onboarding");
  }

  if (business.deleted_at) {
    redirect("/account-deleted");
  }

  redirect("/dashboard");
}
