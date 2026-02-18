import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import type { ReportType } from "@/lib/reports/types";

export const runtime = "nodejs";

const reportTypeSchema = z.enum(["pnl_daily", "asin_profitability", "refund_report"]);

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  return 0;
}

function classifyEvent(eventType: string): { refund: boolean; amazonFee: boolean } {
  const normalized = eventType.toUpperCase();
  return {
    refund:
      normalized.includes("REFUND") ||
      normalized.includes("CHARGEBACK") ||
      normalized.includes("GUARANTEE"),
    amazonFee:
      normalized.includes("SERVICEFEE") ||
      normalized.includes("VALUEADDEDSERVICECHARGE") ||
      normalized.includes("LOANSERVICING") ||
      normalized.includes("CAPACITYRESERVATIONBILLING") ||
      normalized.includes("DEBTRECOVERY") ||
      normalized.includes("RETROCHARGE"),
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);
  if (/[\",\\n]/.test(stringValue)) {
    return `\"${stringValue.replace(/\"/g, '\"\"')}\"`;
  }

  return stringValue;
}

function csv(rows: string[][]): string {
  return rows.map((row) => row.map((value) => escapeCsv(value)).join(",")).join("\\n");
}

function withCsvResponse(fileName: string, content: string): NextResponse {
  return new NextResponse(content, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const typeRaw = requestUrl.searchParams.get("type");
  const from = parseDate(requestUrl.searchParams.get("from"));
  const toInclusive = parseDate(requestUrl.searchParams.get("to"));

  const parsedType = reportTypeSchema.safeParse(typeRaw);
  if (!parsedType.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid report type.",
        },
      },
      { status: 400 },
    );
  }

  if (!from || !toInclusive || toInclusive < from) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Valid from/to query dates are required.",
        },
      },
      { status: 400 },
    );
  }

  const toExclusive = new Date(toInclusive);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const type: ReportType = parsedType.data;

  if (type === "pnl_daily") {
    const rows = await prisma.dailySummary.findMany({
      where: {
        date: {
          gte: from,
          lt: toExclusive,
        },
      },
      orderBy: {
        date: "asc",
      },
    });

    return withCsvResponse(
      `pnl-daily-${from.toISOString().slice(0, 10)}-${toInclusive.toISOString().slice(0, 10)}.csv`,
      csv([
        [
          "date",
          "marketplaceId",
          "sales",
          "ordersCount",
          "units",
          "refunds",
          "amazonFees",
          "otherFees",
          "netPayout",
          "cogs",
          "grossProfit",
          "netProfit",
        ],
        ...rows.map((row) => [
          row.date.toISOString().slice(0, 10),
          row.marketplaceId,
          toNumber(row.sales).toFixed(2),
          String(row.ordersCount),
          String(row.units),
          toNumber(row.refunds).toFixed(2),
          toNumber(row.amazonFees).toFixed(2),
          toNumber(row.otherFees).toFixed(2),
          toNumber(row.netPayout).toFixed(2),
          toNumber(row.cogs).toFixed(2),
          toNumber(row.grossProfit).toFixed(2),
          toNumber(row.netProfit).toFixed(2),
        ]),
      ]),
    );
  }

  if (type === "refund_report") {
    const events = await prisma.financialEvent.findMany({
      where: {
        postedDate: {
          gte: from,
          lt: toExclusive,
        },
      },
      orderBy: {
        postedDate: "asc",
      },
    });

    const refundRows = events.filter((event) => classifyEvent(event.eventType).refund);

    return withCsvResponse(
      `refund-report-${from.toISOString().slice(0, 10)}-${toInclusive.toISOString().slice(0, 10)}.csv`,
      csv([
        ["postedDate", "eventType", "marketplaceId", "amazonOrderId", "asin", "sku", "amount", "currency"],
        ...refundRows.map((event) => [
          event.postedDate.toISOString(),
          event.eventType,
          event.marketplaceId ?? "",
          event.amazonOrderId ?? "",
          event.asin ?? "",
          event.sku ?? "",
          toNumber(event.amount).toFixed(2),
          event.currency,
        ]),
      ]),
    );
  }

  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        purchaseDate: {
          gte: from,
          lt: toExclusive,
        },
      },
    },
    include: {
      order: true,
    },
  });

  const cogsEntries = await prisma.cOGS.findMany();
  const cogsBySku = new Map<string, number>();
  const cogsByAsin = new Map<string, number>();
  for (const entry of cogsEntries) {
    if (entry.sku) {
      cogsBySku.set(entry.sku, toNumber(entry.unitCost));
    }
    if (entry.asin) {
      cogsByAsin.set(entry.asin, toNumber(entry.unitCost));
    }
  }

  const orderIds = [...new Set(orderItems.map((item) => item.amazonOrderId))];
  const orderEvents = await prisma.financialEvent.findMany({
    where: {
      amazonOrderId: {
        in: orderIds,
      },
    },
    select: {
      amazonOrderId: true,
      eventType: true,
      amount: true,
    },
  });

  const orderUnits = new Map<string, number>();
  const orderFees = new Map<string, number>();

  for (const item of orderItems) {
    orderUnits.set(item.amazonOrderId, (orderUnits.get(item.amazonOrderId) ?? 0) + item.quantityOrdered);
  }

  for (const event of orderEvents) {
    if (!event.amazonOrderId) {
      continue;
    }

    if (classifyEvent(event.eventType).amazonFee) {
      orderFees.set(
        event.amazonOrderId,
        (orderFees.get(event.amazonOrderId) ?? 0) + Math.abs(toNumber(event.amount)),
      );
    }
  }

  const refundAllocations = await prisma.refundAllocation.findMany({
    where: {
      orderItemId: {
        in: orderItems.map((item) => item.id),
      },
    },
    select: {
      orderItemId: true,
      amount: true,
    },
  });

  const refundByOrderItem = new Map<string, number>();
  for (const allocation of refundAllocations) {
    refundByOrderItem.set(
      allocation.orderItemId,
      (refundByOrderItem.get(allocation.orderItemId) ?? 0) + toNumber(allocation.amount),
    );
  }

  const byProduct = new Map<
    string,
    {
      sku: string;
      asin: string;
      title: string;
      units: number;
      sales: number;
      refundCost: number;
      cogs: number;
      amazonFees: number;
      netProfit: number;
    }
  >();

  for (const item of orderItems) {
    const sku = item.sku ?? "";
    const asin = item.asin ?? "";
    const key = `${sku}|${asin}|${item.title ?? ""}`;

    const entry = byProduct.get(key) ?? {
      sku,
      asin,
      title: item.title ?? "Untitled product",
      units: 0,
      sales: 0,
      refundCost: 0,
      cogs: 0,
      amazonFees: 0,
      netProfit: 0,
    };

    const units = item.quantityOrdered;
    const sales =
      units * toNumber(item.itemPrice) + toNumber(item.itemTax) - Math.abs(toNumber(item.promotionDiscount));
    const cogs =
      ((item.sku ? cogsBySku.get(item.sku) : undefined) ??
        (item.asin ? cogsByAsin.get(item.asin) : undefined) ??
        0) * units;
    const refundCost = refundByOrderItem.get(item.id) ?? 0;
    const totalOrderUnits = Math.max(orderUnits.get(item.amazonOrderId) ?? 1, 1);
    const feeShare = ((orderFees.get(item.amazonOrderId) ?? 0) * units) / totalOrderUnits;
    const netProfit = sales - cogs - refundCost - feeShare;

    entry.units += units;
    entry.sales += sales;
    entry.refundCost += refundCost;
    entry.cogs += cogs;
    entry.amazonFees += feeShare;
    entry.netProfit += netProfit;
    byProduct.set(key, entry);
  }

  return withCsvResponse(
    `asin-profitability-${from.toISOString().slice(0, 10)}-${toInclusive.toISOString().slice(0, 10)}.csv`,
    csv([
      ["sku", "asin", "title", "units", "sales", "refundCost", "cogs", "amazonFees", "netProfit"],
      ...[...byProduct.values()].map((row) => [
        row.sku,
        row.asin,
        row.title,
        String(row.units),
        row.sales.toFixed(2),
        row.refundCost.toFixed(2),
        row.cogs.toFixed(2),
        row.amazonFees.toFixed(2),
        row.netProfit.toFixed(2),
      ]),
    ]),
  );
}
