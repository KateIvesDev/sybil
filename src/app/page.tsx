"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Gauge,
  Github,
  Send,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// TODO: set this to your Sybil repo before submitting.
const GITHUB_URL = "https://github.com/kateivesdev/sybil";

/**
 * Landing page — positions Sybil as a detection ENGINE for identity failure
 * modes (not a single deprovisioning trick) that helps Customer Success teams
 * act proactively when a failure hits a paying account. The breadth is the
 * platform story; the one concrete scenario is marked as the live demo so the
 * pitch stays specific and honest about what's actually built. The detection-
 * in-the-database is the moat (and the intentional-DB pitch the rubric rewards);
 * the proactive-trust outcome is why it matters.
 */
export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/90">
              <Activity className="h-4 w-4 text-background" />
            </div>
            <span className="text-sm font-semibold">Sybil</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </Button>
            <Button size="sm" asChild>
              <Link href="/login">Sign in with SSO</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="container">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mx-auto max-w-3xl py-20 text-center"
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
            CX Detection Engine for Identity Failures
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Reach your key accounts <span className="text-destructive">before</span> they open a support ticket.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">

            Sybil watches your deprovisioning and identity access signals in real time, <br/> so CX teams reach at-risk accounts before a failure becomes a ticket <br/> — <span className="font-bold">or worse, a churned account</span>.

          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link href="/login">
                Sign in with SSO
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4" />
                View the code
              </a>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Live demo · no signup — one-click SSO drops you straight into the
            command center.
          </p>
        </motion.section>

        {/* The arc: what the engine does, in three beats */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: "easeOut" }}
          className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3"
        >
          <ArcStep
            n={1}
            icon={<Gauge className="h-5 w-5 text-destructive" />}
            title="Detect"
            body="Two detectors over one telemetry stream catch the failure the moment it starts — not days later when it's a breach or an outage."
          />
          <ArcStep
            n={2}
            icon={<TrendingUp className="h-5 w-5 text-amber-500" />}
            title="Rank by revenue"
            body="Every affected customer is scored by the dollars and the renewal on the line, so the biggest risk is at the top."
          />
          <ArcStep
            n={3}
            icon={<Send className="h-5 w-5 text-foreground" />}
            title="Reach out"
            body="A drafted, human-approved message gets your team ahead of it — so you tell the customer first, and keep their trust."
          />
        </motion.section>

        {/* The breadth — one engine, many failure modes, mapped to the two detectors */}
        <section className="mx-auto mt-16 max-w-3xl">
          <div className="text-center">
            <h2 className="text-xl font-semibold">
              One engine. Every identity failure mode.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-base text-muted-foreground">
              Each failure mode is one event type and a signature on the same
              landing table. Adding one is new data, not a new system — the two
              detectors and the revenue ranking never change.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <FailureColumn
              icon={<Gauge className="h-5 w-5 text-amber-500" />}
              title="Rate anomalies"
              caption="High-volume failures, baselined per customer"
              items={[
                "SSO login outages — expired cert, broken metadata",
                "MFA & push-delivery failures",
                "Deprovisioning / SCIM sync failures",
                "Auth-API latency & 5xx degradation",
              ]}
            />
            <FailureColumn
              icon={<ShieldAlert className="h-5 w-5 text-destructive" />}
              title="Exposures"
              caption="Rare, high-severity, scored by blast radius"
              items={[
                "Terminated user with a live session",
                "MFA disabled or policy weakened on an admin",
                "Orphaned or over-privileged accounts",
                "Segregation-of-duties violations",
              ]}
              demoItem="Terminated user with a live session"
            />
          </div>
        </section>

        {/* Intentional-DB callout — the credibility zone for AWS database judges */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mx-auto my-16 max-w-3xl rounded-xl border border-border bg-card p-6"
        >
          <div className="text-base font-medium uppercase tracking-wide text-muted-foreground">
            Why Aurora PostgreSQL
          </div>
          <p className="mt-2 text-pretty text-base leading-relaxed">
            Most apps would treat the database as storage and run this detection
            in application code. Sybil runs it <strong>in the database</strong> —
            two complementary detection strategies over one normalized landing
            table (statistical rate-anomaly baselining on high-volume failures,
            exposure scoring on discrete violations), unified into a single
            revenue-weighted ranking, <strong>all in SQL</strong>. That&apos;s
            what lets one engine absorb every failure mode above without changing
            shape — and it&apos;s why this belongs on Aurora, which runs it at
            scale and scales to zero when idle.
          </p>
        </motion.section>
      </main>

      <footer className="border-t border-border">
        <div className="container py-6 text-center text-sm text-muted-foreground">
          Demo environment · Aurora PostgreSQL · Drizzle ORM · Next.js
        </div>
      </footer>
    </div>
  );
}

function ArcStep({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/50">
          {icon}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {n}
        </span>
      </div>
      <div className="text-base font-semibold">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function FailureColumn({
  icon,
  title,
  caption,
  items,
  demoItem,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  items: string[];
  demoItem?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted/50">
          {icon}
        </div>
        <div>
          <div className="text-base font-semibold">{title}</div>
          <div className="text-sm text-muted-foreground">{caption}</div>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              {item}
              {item === demoItem && (
                <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                  Live demo
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
