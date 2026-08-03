import { redirect } from "next/navigation";
import KnowledgeGapsDashboard from "@/components/knowledge-gaps/KnowledgeGapsDashboard";
import { getDashboardBusinessContext } from "@/lib/dashboard/context";
import { requireWorkspacePageAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { loadKnowledgeGaps } from "@/lib/knowledge-gaps/load";

export default async function KnowledgeGapsPage() {
  await requireWorkspacePageAccess();
  const context = await getDashboardBusinessContext();
  if (context.status === "unauthenticated") redirect("/login");
  if (context.status !== "resolved") redirect("/onboarding");

  const { supabase, business } = context;
  const { data, error } = await loadKnowledgeGaps(supabase, business.id);

  if (error) {
    console.error(
      `[knowledge-gaps:page] Could not load gaps for business=${business.id}:`,
      error
    );
  }

  return (
    <KnowledgeGapsDashboard
      businessId={business.id}
      initialGaps={data}
      loadError={error ? "Knowledge gaps could not be loaded." : null}
      timeZone={business.timezone ?? "UTC"}
    />
  );
}
