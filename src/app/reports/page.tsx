"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SyncRunRow {
  id: string;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  warnings: string[];
  errorMessage: string | null;
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartInput(): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export default function ReportsPage() {
  const [from, setFrom] = useState(monthStartInput());
  const [to, setTo] = useState(todayInput());
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN?.trim();
        const response = await fetch("/api/sync/status", {
          headers: {
            ...(token
              ? {
                  "x-internal-api-token": token,
                }
              : {}),
          },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          runs?: SyncRunRow[];
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Failed to fetch sync status.");
        }

        setSyncRuns(payload.runs ?? []);
      } catch (error) {
        setSyncMessage(error instanceof Error ? error.message : "Failed to fetch sync status.");
      }
    };

    void load();
  }, []);

  const links = useMemo(
    () => [
      {
        label: "P&L Daily",
        type: "pnl_daily",
      },
      {
        label: "ASIN Profitability",
        type: "asin_profitability",
      },
      {
        label: "Refund Report",
        type: "refund_report",
      },
    ],
    [],
  );

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Export CSV reports for P&L, ASIN profitability, and refunds.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.type}
                className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted"
                href={`/api/reports/export?type=${encodeURIComponent(link.type)}&from=${encodeURIComponent(
                  from,
                )}&to=${encodeURIComponent(to)}`}
              >
                Download {link.label}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {syncMessage ? <p className="text-sm text-red-600">{syncMessage}</p> : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Warnings</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No sync history yet.
                    </td>
                  </tr>
                ) : (
                  syncRuns.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="px-3 py-2">{new Date(run.startedAt).toLocaleString("en-GB")}</td>
                      <td className="px-3 py-2">{run.runType}</td>
                      <td className="px-3 py-2">{run.status}</td>
                      <td className="px-3 py-2">{run.durationMs ? `${run.durationMs}ms` : "—"}</td>
                      <td className="px-3 py-2">{run.warnings.length > 0 ? run.warnings.join(" | ") : "—"}</td>
                      <td className="px-3 py-2">{run.errorMessage ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
