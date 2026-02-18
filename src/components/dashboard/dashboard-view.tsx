"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  DashboardGroupBy,
  DashboardKpiMetric,
  DashboardKpiPayload,
  DashboardOrderItemRow,
  DashboardRangePreset,
} from "@/lib/dashboard/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DashboardTab = "products" | "order-items";

interface DashboardViewProps {
  kpis: DashboardKpiPayload;
  initialRows: DashboardOrderItemRow[];
  initialGroupBy?: DashboardGroupBy;
  initialPage?: number;
  initialPageSize?: number;
  initialTotalRows?: number;
  initialTotalPages?: number;
  initialRangePreset?: DashboardRangePreset;
  initialCustomFrom?: string;
  initialCustomTo?: string;
  initialDataNote?: string | null;
}

interface ToastState {
  kind: "success" | "error";
  message: string;
}

function currencyFormatter(currency: string): Intl.NumberFormat {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value: number, currency: string): string {
  try {
    return currencyFormatter(currency).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatOrderTime(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTodayDateInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function KpiTile({
  title,
  metric,
  currency,
}: {
  title: string;
  metric: DashboardKpiMetric;
  currency: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p className="text-2xl font-semibold tracking-tight">{formatCurrency(metric.sales, currency)}</p>
        <p className="text-muted-foreground">
          Orders {formatInteger(metric.orders)} · Units {formatInteger(metric.units)}
        </p>
        <p className="text-muted-foreground">Refunds {formatCurrency(metric.refunds, currency)}</p>
        <p className="text-muted-foreground">Ad cost {formatCurrency(metric.adCost, currency)}</p>
        <p className="text-muted-foreground">
          Est payout {metric.estPayout === null ? "—" : formatCurrency(metric.estPayout, currency)}
        </p>
        <p className="text-muted-foreground">Gross {formatCurrency(metric.grossProfit, currency)}</p>
        <p className="text-muted-foreground">Net {formatCurrency(metric.netProfit, currency)}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardView({
  kpis,
  initialRows,
  initialGroupBy = "none",
  initialPage = 1,
  initialPageSize = 50,
  initialTotalRows = 0,
  initialTotalPages = 1,
  initialRangePreset = "today",
  initialCustomFrom,
  initialCustomTo,
  initialDataNote = null,
}: DashboardViewProps) {
  const router = useRouter();

  const [rows, setRows] = useState<DashboardOrderItemRow[]>(initialRows);
  const [activeTab, setActiveTab] = useState<DashboardTab>("order-items");
  const [rangePreset, setRangePreset] = useState<DashboardRangePreset>(initialRangePreset);
  const [customFrom, setCustomFrom] = useState<string>(
    initialCustomFrom ?? getTodayDateInputValue(),
  );
  const [customTo, setCustomTo] = useState<string>(
    initialCustomTo ?? getTodayDateInputValue(),
  );
  const [search, setSearch] = useState<string>("");
  const [groupBy, setGroupBy] = useState<DashboardGroupBy>(initialGroupBy);
  const [page, setPage] = useState<number>(initialPage);
  const [pageSize] = useState<number>(initialPageSize);
  const [totalRows, setTotalRows] = useState<number>(initialTotalRows);
  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMessageKind, setSyncMessageKind] = useState<"success" | "error" | null>(null);
  const [dataNote, setDataNote] = useState<string | null>(initialDataNote);

  const isFirstFetch = useRef(true);
  const internalApiToken = process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN?.trim();

  const tiles = useMemo(
    () => [
      { title: "Today", metric: kpis.today },
      { title: "Yesterday", metric: kpis.yesterday },
      { title: "Month to date", metric: kpis.monthToDate },
      { title: "This month forecast", metric: kpis.thisMonthForecast },
      { title: "Last month", metric: kpis.lastMonth },
    ],
    [kpis],
  );

  const hasLatestOrderDate = Boolean(kpis.latestOrderDate);
  const latestOrderDateInput = kpis.latestOrderDate?.slice(0, 10);
  const latestOrderNotToday =
    Boolean(latestOrderDateInput) && latestOrderDateInput !== getTodayDateInputValue();
  const currentRangeLabel =
    rangePreset === "today"
      ? "Default view: today order items"
      : rangePreset === "yesterday"
        ? "Viewing yesterday order items"
        : rangePreset === "mtd"
          ? "Viewing month-to-date order items"
          : customFrom === customTo
            ? `Viewing custom date: ${customFrom}`
            : `Viewing custom range: ${customFrom} to ${customTo}`;

  const loadRows = useCallback(async () => {
    setIsRowsLoading(true);

    try {
      const params = new URLSearchParams({
        range: rangePreset,
        marketplaceId: kpis.marketplaceId,
        groupBy,
        page: String(page),
        pageSize: String(pageSize),
      });

      if (rangePreset === "custom") {
        params.set("from", customFrom);
        params.set("to", customTo);
      }

      if (search.trim().length > 0) {
        params.set("search", search.trim());
      }

      const response = await fetch(`/api/dashboard/order-items?${params.toString()}`);
      const payload = (await response.json()) as {
        rows?: DashboardOrderItemRow[];
        page?: number;
        totalRows?: number;
        totalPages?: number;
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Failed to load order items");
      }

      setRows(payload.rows ?? []);
      setPage(payload.page ?? 1);
      setTotalRows(payload.totalRows ?? 0);
      setTotalPages(payload.totalPages ?? 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load order items";
      setToast({
        kind: "error",
        message,
      });
    } finally {
      setIsRowsLoading(false);
    }
  }, [customFrom, customTo, groupBy, kpis.marketplaceId, page, pageSize, rangePreset, search]);

  useEffect(() => {
    if (isFirstFetch.current) {
      isFirstFetch.current = false;
      return;
    }

    const timer = setTimeout(() => {
      void loadRows();
    }, 300);

    return () => clearTimeout(timer);
  }, [loadRows]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (isFirstFetch.current) {
      return;
    }

    setPage(1);
  }, [rangePreset, customFrom, customTo, search, groupBy]);

  const onSyncNow = useCallback(async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    setSyncMessageKind(null);

    try {
      const response = await fetch("/api/sync/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(internalApiToken
            ? {
                "x-internal-api-token": internalApiToken,
              }
            : {}),
        },
        body: JSON.stringify({
          days: 120,
          marketplaceId: kpis.marketplaceId,
        }),
      });

      const payload = (await response.json()) as {
        result?: {
          orders?: {
            ordersFetched?: number;
          };
        };
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Sync failed");
      }

      setToast({
        kind: "success",
        message: `Sync complete. Orders fetched: ${payload.result?.orders?.ordersFetched ?? 0}`,
      });
      setSyncMessage(`Sync complete. Orders fetched: ${payload.result?.orders?.ordersFetched ?? 0}`);
      setSyncMessageKind("success");

      await loadRows();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";

      setToast({
        kind: "error",
        message,
      });
      setSyncMessage(message);
      setSyncMessageKind("error");
    } finally {
      setIsSyncing(false);
    }
  }, [internalApiToken, kpis.marketplaceId, loadRows, router]);

  const onLoadLatestActivity = useCallback(() => {
    if (!latestOrderDateInput) {
      return;
    }

    setRangePreset("custom");
    setCustomFrom(latestOrderDateInput);
    setCustomTo(latestOrderDateInput);
    setDataNote(`Showing latest synced activity (${formatDate(kpis.latestOrderDate!)}).`);
  }, [kpis.latestOrderDate, latestOrderDateInput]);

  return (
    <section className="space-y-5">
      {toast ? (
        <div
          className={`fixed top-4 right-4 z-50 rounded-md px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Sellerboard-style view backed by local SP-API synced data.
          </p>
          {dataNote ? <p className="text-xs text-amber-700">{dataNote}</p> : null}
          {hasLatestOrderDate ? (
            <p className="text-xs text-muted-foreground">
              Last synced order date: {formatDate(kpis.latestOrderDate!)}
            </p>
          ) : null}
          {kpis.lastSyncAt ? (
            <p className="text-xs text-muted-foreground">
              Last sync run: {formatDate(kpis.lastSyncAt)} {formatOrderTime(kpis.lastSyncAt)}
            </p>
          ) : null}
          {kpis.dataStale ? (
            <p className="text-xs text-amber-700">
              Sync data is older than 6 hours. Run sync now to refresh numbers.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <Button onClick={() => void onSyncNow()} disabled={isSyncing}>
            {isSyncing ? "Syncing..." : "Sync now"}
          </Button>
          {syncMessage ? (
            <p
              className={`text-xs ${
                syncMessageKind === "error" ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {syncMessage}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {tiles.map((tile) => (
          <KpiTile key={tile.title} title={tile.title} metric={tile.metric} currency={kpis.currency} />
        ))}
      </div>

      {kpis.alerts.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {kpis.alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-md border px-3 py-2 text-sm ${
                alert.level === "warning"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-blue-300 bg-blue-50 text-blue-900"
              }`}
            >
              <p className="font-medium">{alert.title}</p>
              <p>{alert.message}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border bg-background p-1">
              <button
                type="button"
                className={`rounded px-3 py-1 text-sm ${
                  activeTab === "products" ? "bg-muted font-medium" : "text-muted-foreground"
                }`}
                onClick={() => setActiveTab("products")}
              >
                Products
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1 text-sm ${
                  activeTab === "order-items"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground"
                }`}
                onClick={() => setActiveTab("order-items")}
              >
                Order Items
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{currentRangeLabel}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeTab === "products" ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              Product workspace is now available under the dedicated Products module.
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Date range
                  </label>
                  <select
                    value={rangePreset}
                    onChange={(event) => {
                      setRangePreset(event.target.value as DashboardRangePreset);
                      setDataNote(null);
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="mtd">Month-to-date</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {rangePreset === "custom" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        From
                      </label>
                      <Input
                        type="date"
                        value={customFrom}
                        onChange={(event) => setCustomFrom(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        To
                      </label>
                      <Input
                        type="date"
                        value={customTo}
                        onChange={(event) => setCustomTo(event.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Search
                      </label>
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="SKU / ASIN / title"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Group by
                      </label>
                      <select
                        value={groupBy}
                        onChange={(event) => setGroupBy(event.target.value as DashboardGroupBy)}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="none">None</option>
                        <option value="product">Product</option>
                        <option value="order">Order</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              {rangePreset === "custom" ? (
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Search
                    </label>
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="SKU / ASIN / title"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Group by
                    </label>
                    <select
                      value={groupBy}
                      onChange={(event) => setGroupBy(event.target.value as DashboardGroupBy)}
                      className="h-9 w-full min-w-[180px] rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="none">None</option>
                      <option value="product">Product</option>
                      <option value="order">Order</option>
                    </select>
                  </div>
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Units sold</th>
                      <th className="px-3 py-2">Refunds</th>
                      <th className="px-3 py-2">Sales</th>
                      <th className="px-3 py-2">Refund cost</th>
                      <th className="px-3 py-2">Cost of goods</th>
                      <th className="px-3 py-2">Amazon fees</th>
                      <th className="px-3 py-2">Net profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isRowsLoading ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                          Loading order items...
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                          <p>No order items for this filter.</p>
                          {rangePreset === "today" && latestOrderNotToday ? (
                            <button
                              type="button"
                              onClick={onLoadLatestActivity}
                              className="mt-1 text-xs text-primary underline"
                            >
                              View latest activity ({formatDate(kpis.latestOrderDate!)})
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr key={row.id} className="border-t align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium">{row.amazonOrderId}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatOrderTime(row.purchaseDate)}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              {row.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={row.imageUrl}
                                  alt={row.productTitle}
                                  className="h-10 w-10 rounded border object-cover"
                                />
                              ) : (
                                <div className="h-10 w-10 rounded border bg-muted" />
                              )}
                              <div className="min-w-[220px]">
                                <p className="line-clamp-2 font-medium">{row.productTitle}</p>
                                <p className="text-xs text-muted-foreground">
                                  ASIN: {row.asin ?? "—"} · SKU: {row.sku ?? "—"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">{formatInteger(row.unitsSold)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.refunds, kpis.currency)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.sales, kpis.currency)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.refundCost, kpis.currency)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.cogs, kpis.currency)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.amazonFees, kpis.currency)}</td>
                          <td className="px-3 py-2">{formatCurrency(row.netProfit, kpis.currency)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Showing {rows.length} of {formatInteger(totalRows)} rows · Page {page} of{" "}
                  {Math.max(totalPages, 1)}
                </p>
                <div className="inline-flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRowsLoading || page <= 1}
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRowsLoading || page >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(current + 1, Math.max(totalPages, 1)))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
