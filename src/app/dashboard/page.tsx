import Link from "next/link";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  getDashboardKpis,
  getDashboardOrderItems,
  type DashboardRangePreset,
} from "@/lib/dashboard/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDayForUi(dateInput: string): string {
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? dateInput
    : new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

export default async function DashboardPage() {
  let kpis: Awaited<ReturnType<typeof getDashboardKpis>> | null = null;
  let initialRows: Awaited<ReturnType<typeof getDashboardOrderItems>>["rows"] = [];
  let initialRangePreset: DashboardRangePreset = "today";
  let initialCustomFrom = new Date().toISOString().slice(0, 10);
  let initialCustomTo = initialCustomFrom;
  let initialDataNote: string | null = null;
  let errorMessage: string | null = null;

  try {
    kpis = await getDashboardKpis();
    const orderItems = await getDashboardOrderItems({
      range: {
        preset: "today",
      },
      marketplaceId: kpis.marketplaceId,
    });

    initialRows = orderItems.rows;

    const latestDateInput = kpis.latestOrderDate?.slice(0, 10) ?? null;
    const todayInput = new Date().toISOString().slice(0, 10);

    if (initialRows.length === 0 && latestDateInput && latestDateInput !== todayInput) {
      const latestRangeItems = await getDashboardOrderItems({
        range: {
          preset: "custom",
          from: latestDateInput,
          to: latestDateInput,
        },
        marketplaceId: kpis.marketplaceId,
      });

      if (latestRangeItems.rows.length > 0) {
        initialRows = latestRangeItems.rows;
        initialRangePreset = "custom";
        initialCustomFrom = latestDateInput;
        initialCustomTo = latestDateInput;
        initialDataNote = `No orders for today. Showing latest synced activity (${formatDayForUi(latestDateInput)}).`;
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load dashboard data";
  }

  if (!kpis) {
    return (
      <section className="space-y-3 p-4 md:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <p className="text-sm text-muted-foreground">
          Set up your account on <Link href="/settings" className="underline">Settings</Link>,
          then run a sync.
        </p>
      </section>
    );
  }

  return (
    <section className="p-4 md:p-6">
      <DashboardView
        kpis={kpis}
        initialRows={initialRows}
        initialRangePreset={initialRangePreset}
        initialCustomFrom={initialCustomFrom}
        initialCustomTo={initialCustomTo}
        initialDataNote={initialDataNote}
      />
    </section>
  );
}
