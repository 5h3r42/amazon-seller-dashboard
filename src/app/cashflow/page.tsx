import { prisma } from "@/lib/db";

function toNumber(value: { toString: () => string } | number | null): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function CashflowPage() {
  const now = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);

  const summaries = await prisma.dailySummary.findMany({
    where: {
      date: {
        gte: from,
        lte: now,
      },
    },
    orderBy: {
      date: "asc",
    },
  });

  const totalNetPayout30d = summaries.reduce((sum, row) => sum + toNumber(row.netPayout), 0);
  const averageDailyPayout = summaries.length > 0 ? totalNetPayout30d / summaries.length : 0;
  const projection14 = averageDailyPayout * 14;
  const projection30 = averageDailyPayout * 30;

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cashflow</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Projection based on recent payout velocity from daily summaries.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-4">
          <p className="text-xs uppercase text-muted-foreground">30d Net Payout</p>
          <p className="text-2xl font-semibold">£{totalNetPayout30d.toFixed(2)}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs uppercase text-muted-foreground">14d Projection</p>
          <p className="text-2xl font-semibold">£{projection14.toFixed(2)}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-xs uppercase text-muted-foreground">30d Projection</p>
          <p className="text-2xl font-semibold">£{projection30.toFixed(2)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Sales</th>
              <th className="px-3 py-2">Net Payout</th>
              <th className="px-3 py-2">Net Profit</th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No daily summary rows found. Run sync to populate cashflow.
                </td>
              </tr>
            ) : (
              summaries.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.date.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-2">£{toNumber(row.sales).toFixed(2)}</td>
                  <td className="px-3 py-2">£{toNumber(row.netPayout).toFixed(2)}</td>
                  <td className="px-3 py-2">£{toNumber(row.netProfit).toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
