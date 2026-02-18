import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const saveCogsSchema = z
  .object({
    sku: z.string().trim().min(1).optional(),
    asin: z.string().trim().min(1).optional(),
    unitCost: z.number().finite().min(0),
    includesVat: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.sku || value.asin), {
    message: "Either sku or asin is required.",
    path: ["sku"],
  });

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim().toLowerCase();

  const entries = await prisma.cOGS.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    take: 300,
  });

  const filtered = search
    ? entries.filter((entry) =>
        [entry.sku, entry.asin].some((value) => value?.toLowerCase().includes(search)),
      )
    : entries;

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);

  const recentOrderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        purchaseDate: {
          gte: from,
        },
      },
    },
    select: {
      sku: true,
      asin: true,
      quantityOrdered: true,
      itemPrice: true,
      itemTax: true,
      promotionDiscount: true,
    },
  });

  const metricsBySku = new Map<string, { units: number; sales: number }>();
  const metricsByAsin = new Map<string, { units: number; sales: number }>();

  for (const item of recentOrderItems) {
    const sales =
      item.quantityOrdered * toNumber(item.itemPrice?.toString() ?? "0") +
      toNumber(item.itemTax?.toString() ?? "0") -
      Math.abs(toNumber(item.promotionDiscount?.toString() ?? "0"));

    if (item.sku) {
      const current = metricsBySku.get(item.sku) ?? { units: 0, sales: 0 };
      current.units += item.quantityOrdered;
      current.sales += sales;
      metricsBySku.set(item.sku, current);
    }

    if (item.asin) {
      const current = metricsByAsin.get(item.asin) ?? { units: 0, sales: 0 };
      current.units += item.quantityOrdered;
      current.sales += sales;
      metricsByAsin.set(item.asin, current);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      entries: filtered.map((entry) => {
        const metrics =
          (entry.sku ? metricsBySku.get(entry.sku) : undefined) ??
          (entry.asin ? metricsByAsin.get(entry.asin) : undefined) ??
          { units: 0, sales: 0 };
        const cogs = metrics.units * toNumber(entry.unitCost.toString());
        const marginPct = metrics.sales > 0 ? ((metrics.sales - cogs) / metrics.sales) * 100 : 0;

        return {
          id: entry.id,
          sku: entry.sku,
          asin: entry.asin,
          unitCost: toNumber(entry.unitCost.toString()),
          includesVat: entry.includesVat,
          updatedAt: entry.updatedAt,
          metrics: {
            last30dUnits: metrics.units,
            last30dSales: Number(metrics.sales.toFixed(2)),
            last30dEstimatedMarginPct: Number(marginPct.toFixed(2)),
          },
        };
      }),
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = (await request.json()) as unknown;
    const payload = saveCogsSchema.parse(json);

    const existing = await prisma.cOGS.findFirst({
      where: {
        OR: [
          payload.sku ? { sku: payload.sku } : undefined,
          payload.asin ? { asin: payload.asin } : undefined,
        ].filter(Boolean) as Array<{ sku?: string; asin?: string }>,
      },
    });

    const data = {
      sku: payload.sku ?? null,
      asin: payload.asin ?? null,
      unitCost: payload.unitCost,
      includesVat: payload.includesVat ?? false,
    };

    const entry = existing
      ? await prisma.cOGS.update({
          where: {
            id: existing.id,
          },
          data,
        })
      : await prisma.cOGS.create({
          data,
        });

    return NextResponse.json(
      {
        ok: true,
        entry: {
          id: entry.id,
          sku: entry.sku,
          asin: entry.asin,
          unitCost: toNumber(entry.unitCost.toString()),
          includesVat: entry.includesVat,
          updatedAt: entry.updatedAt,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: error.issues.map((issue) => issue.message).join(", "),
          },
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Failed to save COGS entry";

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
