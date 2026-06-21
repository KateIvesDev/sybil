import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

// The live command center. Arriving with ?demo=1 (set by the SSO gate) arms the
// one-time auto-trigger so the green→red arc plays itself for an unattended judge.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  return <Dashboard demoArmed={sp.demo === "1"} />;
}
