import { Prisma } from "@prisma/client";

import { ConfigError } from "@/lib/env";
import { prisma } from "@/lib/db";

export type DashboardRangePreset = "today" | "yesterday" | "mtd" | "custom";

export interface DashboardRangeInput {
  preset: DashboardRangePreset;
  from?: string;
  to?: string;
}

export interface ResolvedDashboardRange {
  preset: DashboardRangePreset;
  startDate: Date;
  endExclusive: Date;
  label: string;
}

export interface DashboardKpiMetric {
  sales: number;
  orders: number;
  units: number;
  refunds: number;
  adCost: number;
  estPayout: number | null;
  grossProfit: number;
  netProfit: number;
}

export interface DashboardKpiPayload {
  marketplaceId: string;
  currency: string;
  latestOrderDate: string | null;
  today: DashboardKpiMetric;
  yesterday: DashboardKpiMetric;
  monthToDate: DashboardKpiMetric;
  thisMonthForecast: DashboardKpiMetric;
  lastMonth: DashboardKpiMetric;
}

export interface DashboardOrderItemRow {
  id: string;
  amazonOrderId: string;
  purchaseDate: string;
  productTitle: string;
  asin: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitsSold: number;
  refunds: number;
  sales: number;
  refundCost: number;
  cogs: number;
  amazonFees: number;
  netProfit: number;
}

const DEFAULT_CURRENCY = "GBP";

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  return 0;
}

function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function resolveMarketplaceId(input?: string): Promise<string> {
  if (input?.trim()) {
    return input.trim();
  }

  const connection = await prisma.amazonConnection.findFirst({
    orderBy: {
      createdAt: "desc",
    },
  });

  if (connection?.marketplaceId) {
    return connection.marketplaceId;
  }

  const envMarketplace = process.env.SP_API_MARKETPLACE_ID?.trim();

  if (envMarketplace) {
    return envMarketplace;
  }

  throw new ConfigError(
    "Missing marketplaceId. Save an Amazon connection or set SP_API_MARKETPLACE_ID.",
  );
}

export function resolveDashboardRange(input: DashboardRangeInput): ResolvedDashboardRange {
  const today = startOfUtcDay(new Date());

  if (input.preset === "today") {
    return {
      preset: "today",
      startDate: today,
      endExclusive: addUtcDays(today, 1),
      label: "Today",
    };
  }

  if (input.preset === "yesterday") {
    const yesterday = addUtcDays(today, -1);
    return {
      preset: "yesterday",
      startDate: yesterday,
      endExclusive: today,
      label: "Yesterday",
    };
  }

  if (input.preset === "mtd") {
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return {
      preset: "mtd",
      startDate: monthStart,
      endExclusive: addUtcDays(today, 1),
      label: "Month to date",
    };
  }

  const parsedFrom = parseDateInput(input.from);
  const parsedTo = parseDateInput(input.to);

  if (!parsedFrom || !parsedTo || parsedTo < parsedFrom) {
    return {
      preset: "today",
      startDate: today,
      endExclusive: addUtcDays(today, 1),
      label: "Today",
    };
  }

  return {
    preset: "custom",
    startDate: parsedFrom,
    endExclusive: addUtcDays(parsedTo, 1),
    label: "Custom",
  };
}

async function aggregateMetric(
  marketplaceId: string,
  startDate: Date,
  endExclusive: Date,
): Promise<DashboardKpiMetric> {
  const aggregate = await prisma.dailySummary.aggregate({
    where: {
      marketplaceId,
      date: {
        gte: startDate,
        lt: endExclusive,
      },
    },
    _sum: {
      sales: true,
      ordersCount: true,
      units: true,
      refunds: true,
      netPayout: true,
      grossProfit: true,
      netProfit: true,
    },
  });

  return {
    sales: toNumber(aggregate._sum.sales),
    orders: aggregate._sum.ordersCount ?? 0,
    units: aggregate._sum.units ?? 0,
    refunds: toNumber(aggregate._sum.refunds),
    adCost: 0,
    estPayout: toNumber(aggregate._sum.netPayout),
    grossProfit: toNumber(aggregate._sum.grossProfit),
    netProfit: toNumber(aggregate._sum.netProfit),
  };
}

function projectThisMonthForecast(monthToDate: DashboardKpiMetric, today: Date): DashboardKpiMetric {
  const daysElapsed = Math.max(today.getUTCDate(), 1);
  const daysInMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const multiplier = daysInMonth / daysElapsed;

  return {
    sales: monthToDate.sales * multiplier,
    orders: Math.round(monthToDate.orders * multiplier),
    units: Math.round(monthToDate.units * multiplier),
    refunds: monthToDate.refunds * multiplier,
    adCost: 0,
    estPayout:
      monthToDate.estPayout === null ? null : monthToDate.estPayout * multiplier,
    grossProfit: monthToDate.grossProfit * multiplier,
    netProfit: monthToDate.netProfit * multiplier,
  };
}

export async function getDashboardKpis(
  marketplaceId?: string,
): Promise<DashboardKpiPayload> {
  const resolvedMarketplaceId = await resolveMarketplaceId(marketplaceId);
  const today = startOfUtcDay(new Date());
  const tomorrow = addUtcDays(today, 1);
  const yesterday = addUtcDays(today, -1);

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const lastMonthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
  );

  const todayMetric = await aggregateMetric(resolvedMarketplaceId, today, tomorrow);
  const yesterdayMetric = await aggregateMetric(resolvedMarketplaceId, yesterday, today);
  const monthToDateMetric = await aggregateMetric(
    resolvedMarketplaceId,
    monthStart,
    tomorrow,
  );
  const lastMonthMetric = await aggregateMetric(
    resolvedMarketplaceId,
    lastMonthStart,
    monthStart,
  );

  const latestOrder = await prisma.order.findFirst({
    where: {
      marketplaceId: resolvedMarketplaceId,
    },
    orderBy: {
      purchaseDate: "desc",
    },
    select: {
      currency: true,
      purchaseDate: true,
    },
  });

  const currency = latestOrder?.currency ?? DEFAULT_CURRENCY;

  return {
    marketplaceId: resolvedMarketplaceId,
    currency,
    latestOrderDate: latestOrder ? latestOrder.purchaseDate.toISOString() : null,
    today: todayMetric,
    yesterday: yesterdayMetric,
    monthToDate: monthToDateMetric,
    thisMonthForecast: projectThisMonthForecast(monthToDateMetric, today),
    lastMonth: lastMonthMetric,
  };
}

function classifyEvent(eventType: string): {
  refund: boolean;
  amazonFee: boolean;
} {
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

function normalizeSearchTerm(value: string | undefined): string {
  return value?.trim() ?? "";
}

export async function getDashboardOrderItems(params: {
  range: DashboardRangeInput;
  search?: string;
  marketplaceId?: string;
}): Promise<{ rows: DashboardOrderItemRow[]; marketplaceId: string }> {
  const resolvedMarketplaceId = await resolveMarketplaceId(params.marketplaceId);
  const resolvedRange = resolveDashboardRange(params.range);
  const search = normalizeSearchTerm(params.search);

  const where: Prisma.OrderItemWhereInput = {
    order: {
      marketplaceId: resolvedMarketplaceId,
      purchaseDate: {
        gte: resolvedRange.startDate,
        lt: resolvedRange.endExclusive,
      },
    },
  };

  if (search.length > 0) {
    where.OR = [
      { sku: { contains: search } },
      { asin: { contains: search } },
      { title: { contains: search } },
      { product: { is: { title: { contains: search } } } },
    ];
  }

  const orderItems = await prisma.orderItem.findMany({
    where,
    include: {
      order: true,
      product: true,
    },
    orderBy: [
      {
        order: {
          purchaseDate: "desc",
        },
      },
      {
        id: "desc",
      },
    ],
    take: 500,
  });

  if (orderItems.length === 0) {
    return {
      rows: [],
      marketplaceId: resolvedMarketplaceId,
    };
  }

  const cogsEntries = await prisma.cOGS.findMany();
  const cogsBySku = new Map<string, number>();
  const cogsByAsin = new Map<string, number>();

  for (const entry of cogsEntries) {
    const unitCost = toNumber(entry.unitCost);
    if (entry.sku) {
      cogsBySku.set(entry.sku, unitCost);
    }
    if (entry.asin) {
      cogsByAsin.set(entry.asin, unitCost);
    }
  }

  const orderIds = [...new Set(orderItems.map((item) => item.amazonOrderId))];
  const events = await prisma.financialEvent.findMany({
    where: {
      amazonOrderId: {
        in: orderIds,
      },
    },
  });

  const orderFees = new Map<string, number>();
  const orderRefunds = new Map<string, number>();
  const orderUnits = new Map<string, number>();

  for (const item of orderItems) {
    const current = orderUnits.get(item.amazonOrderId) ?? 0;
    orderUnits.set(item.amazonOrderId, current + item.quantityOrdered);
  }

  for (const event of events) {
    if (!event.amazonOrderId) {
      continue;
    }

    const classification = classifyEvent(event.eventType);
    const amount = Math.abs(toNumber(event.amount));

    if (classification.amazonFee) {
      orderFees.set(event.amazonOrderId, (orderFees.get(event.amazonOrderId) ?? 0) + amount);
    }

    if (classification.refund) {
      orderRefunds.set(
        event.amazonOrderId,
        (orderRefunds.get(event.amazonOrderId) ?? 0) + amount,
      );
    }
  }

  const rows: DashboardOrderItemRow[] = orderItems.map((item) => {
    const unitsSold = item.quantityOrdered;
    const itemPrice = toNumber(item.itemPrice);
    const itemTax = toNumber(item.itemTax);
    const promotionDiscount = Math.abs(toNumber(item.promotionDiscount));
    const sales = itemPrice * unitsSold + itemTax - promotionDiscount;

    const unitCost =
      (item.sku ? cogsBySku.get(item.sku) : undefined) ??
      (item.asin ? cogsByAsin.get(item.asin) : undefined) ??
      0;

    const cogs = unitCost * unitsSold;

    const totalOrderUnits = Math.max(orderUnits.get(item.amazonOrderId) ?? 1, 1);
    const feeShare =
      ((orderFees.get(item.amazonOrderId) ?? 0) * unitsSold) / totalOrderUnits;
    const refundShare =
      ((orderRefunds.get(item.amazonOrderId) ?? 0) * unitsSold) / totalOrderUnits;

    const netProfit = sales - feeShare - cogs;

    return {
      id: item.id,
      amazonOrderId: item.amazonOrderId,
      purchaseDate: item.order.purchaseDate.toISOString(),
      productTitle: item.title ?? item.product?.title ?? "Unknown product",
      asin: item.asin,
      sku: item.sku,
      imageUrl: item.product?.imageUrl ?? null,
      unitsSold,
      refunds: item.isRefunded ? refundShare : 0,
      sales,
      refundCost: 0,
      cogs,
      amazonFees: feeShare,
      netProfit,
    };
  });

  return {
    rows,
    marketplaceId: resolvedMarketplaceId,
  };
}
