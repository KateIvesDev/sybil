"use client";

import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The "View query" affordance — reveals the real correlation SQL on demand.
 * The thing to flash for the AWS judges: errors JOINed to ARR, in the database,
 * ranked by dollars at risk. The revenue weighting IS the product.
 */
export function ViewQueryDialog({ sql }: { sql: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Code2 className="h-3.5 w-3.5" />
          View query
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>The dual-signal correlation</DialogTitle>
          <DialogDescription>
            Live SQL behind this feed. Two detectors over one landing table — a{" "}
            <code className="text-destructive">z-score</code> rate anomaly on
            deprovisioning-sync failures and{" "}
            <code className="text-destructive">exposure scoring</code> on discrete
            stale-access violations — blended into one revenue-weighted{" "}
            <code className="text-destructive">risk_score</code>, all in Aurora.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-[#0b0e14] p-4 text-[12.5px] leading-relaxed text-emerald-200/90">
          <code>{sql}</code>
        </pre>
      </DialogContent>
    </Dialog>
  );
}
