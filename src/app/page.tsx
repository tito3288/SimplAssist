import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("business_type")
    .eq("owner_id", user.id)
    .single();

  if (!business || business.business_type === "general") {
    redirect("/onboarding");
  }

  redirect("/dashboard");
}
