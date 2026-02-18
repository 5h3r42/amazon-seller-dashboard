"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface CogsEntry {
  id: string;
  sku: string | null;
  asin: string | null;
  unitCost: number;
  includesVat: boolean;
  updatedAt: string;
  metrics: {
    last30dUnits: number;
    last30dSales: number;
    last30dEstimatedMarginPct: number;
  };
}

export default function ProductsPage() {
  const [entries, setEntries] = useState<CogsEntry[]>([]);
  const [sku, setSku] = useState("");
  const [asin, setAsin] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [includesVat, setIncludesVat] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | null>(null);

  const loadEntries = useCallback(async () => {
    const response = await fetch("/api/products/cogs", { cache: "no-store" });
    const payload = (await response.json()) as {
      entries?: CogsEntry[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Failed to load COGS entries.");
    }

    setEntries(payload.entries ?? []);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setMessage(null);
      setMessageKind(null);

      try {
        const parsedCost = Number.parseFloat(unitCost);
        if (!Number.isFinite(parsedCost) || parsedCost < 0) {
          throw new Error("Enter a valid unit cost.");
        }

        const response = await fetch("/api/products/cogs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sku: sku.trim() || undefined,
            asin: asin.trim() || undefined,
            unitCost: parsedCost,
            includesVat,
          }),
        });

        const payload = (await response.json()) as {
          error?: { message?: string };
        };

        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Failed to save COGS.");
        }

        setSku("");
        setAsin("");
        setUnitCost("");
        setIncludesVat(false);
        setMessageKind("success");
        setMessage("COGS entry saved.");
        await loadEntries();
      } catch (error) {
        setMessageKind("error");
        setMessage(error instanceof Error ? error.message : "Failed to save COGS.");
      } finally {
        setIsSaving(false);
      }
    },
    [asin, includesVat, loadEntries, sku, unitCost],
  );

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Maintain SKU/ASIN cost baselines and monitor 30-day margin visibility.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>COGS Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={onSubmit}>
            <Input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="SKU (optional)" />
            <Input value={asin} onChange={(event) => setAsin(event.target.value)} placeholder="ASIN (optional)" />
            <Input
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              placeholder="Unit cost"
              type="number"
              min="0"
              step="0.01"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includesVat}
                onChange={(event) => setIncludesVat(event.target.checked)}
              />
              Includes VAT
            </label>
            <Button type="submit" disabled={isSaving} className="md:col-span-4 md:w-fit">
              {isSaving ? "Saving..." : "Save COGS"}
            </Button>
            {message ? (
              <p className={`text-sm ${messageKind === "error" ? "text-red-600" : "text-emerald-600"}`}>
                {message}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>COGS Coverage</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">ASIN</th>
                <th className="px-3 py-2">Unit Cost</th>
                <th className="px-3 py-2">30d Units</th>
                <th className="px-3 py-2">30d Sales</th>
                <th className="px-3 py-2">30d Margin %</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No COGS entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="px-3 py-2">{entry.sku ?? "—"}</td>
                    <td className="px-3 py-2">{entry.asin ?? "—"}</td>
                    <td className="px-3 py-2">{entry.unitCost.toFixed(2)}</td>
                    <td className="px-3 py-2">{entry.metrics.last30dUnits}</td>
                    <td className="px-3 py-2">{entry.metrics.last30dSales.toFixed(2)}</td>
                    <td className="px-3 py-2">{entry.metrics.last30dEstimatedMarginPct.toFixed(2)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}
