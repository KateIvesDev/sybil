"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Zap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Demo mechanics — flip the dashboard from green to one-red-truth, live.
 * "Trigger incident" bursts errors against high-ARR enterprises;
 * "Reset" returns everything to all-green.
 */
export function DemoControls({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState<"trigger" | "reset" | null>(null);

  async function run(kind: "trigger" | "reset") {
    setBusy(kind);
    try {
      const res = await fetch(`/api/incident/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "failed");
      if (kind === "trigger") {
        toast.error(
          `Incident detected — ${data.accountsImpacted} accounts impacted`,
          {
            description: `${data.eventsWritten} error events · ${data.draftsCreated} outreach drafts queued`,
          },
        );
      } else {
        toast.success("Reset - all green");
      }
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Action failed (did you seed?)",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="destructive"
        size="sm"
        onClick={() => run("trigger")}
        disabled={busy !== null}
        className="gap-1.5"
      >
        <Zap className="h-3.5 w-3.5" />
        {busy === "trigger" ? "Triggering…" : "Trigger incident"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => run("reset")}
        disabled={busy !== null}
        className="gap-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {busy === "reset" ? "Resetting…" : "Reset"}
      </Button>
    </div>
  );
}
