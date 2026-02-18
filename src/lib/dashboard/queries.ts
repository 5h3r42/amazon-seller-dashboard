import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ConfigError } from "@/lib/env";

export type DashboardRangePreset = "today" | "yesterday" | "mtd" | "custom";
export type DashboardGroupBy = "none" | "product" | "order";

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

export interface DashboardAlert {
  id: string;
  level: "warning" | "info";
  title: string;
  message: string;
}

export interface DashboardKpiPayload {
  marketplaceId: string;
  currency: string;
  latestOrderDate: string | null;
  lastSyncAt: string | null;
  dataStale: boolean;
  alerts: DashboardAlert[];
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

export interface DashboardOrderItemsPayload {
  rows: DashboardOrderItemRow[];
  marketplaceId: string;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  groupBy: DashboardGroupBy;
}

const DEFAULT_CURRENCY = "GBP";
const DEFAULT_PAGE_SIZE = 50;
const GROUPED_FETCH_LIMIT = 5000;
const DATA_STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

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

function clampPositiveInt(input: number | undefined, fallback: number): number {
  if (!input || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }

  return Math.floor(input);
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
      otherFees: true,
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
    adCost: toNumber(aggregate._sum.otherFees),
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
    adCost: monthToDate.adCost * multiplier,
    estPayout:
      monthToDate.estPayout === null ? null : monthToDate.estPayout * multiplier,
    grossProfit: monthToDate.grossProfit * multiplier,
    netProfit: monthToDate.netProfit * multiplier,
  };
}

async function buildDashboardAlerts(
  marketplaceId: string,
  now: Date,
  lastSyncAt: Date | null,
): Promise<DashboardAlert[]> {
  const alerts: DashboardAlert[] = [];

  if (!lastSyncAt || now.getTime() - lastSyncAt.getTime() > DATA_STALE_THRESHOLD_MS) {
    alerts.push({
      id: "stale-data",
      level: "warning",
      title: "Data is stale",
      message: "Latest sync is older than 6 hours. Run a sync to refresh dashboard numbers.",
    });
  }

  const lookbackStart = addUtcDays(startOfUtcDay(now), -30);
  const cogsEntries = await prisma.cOGS.findMany({
    select: {
      sku: true,
      asin: true,
    },
  });

  const cogsSkus = new Set(cogsEntries.map((entry) => entry.sku).filter(Boolean));
  const cogsAsins = new Set(cogsEntries.map((entry) => entry.asin).filter(Boolean));

  const recentItems = await prisma.orderItem.findMany({
    where: {
      order: {
        marketplaceId,
        purchaseDate: {
          gte: lookbackStart,
          lt: now,
        },
      },
    },
    select: {
      quantityOrdered: true,
      sku: true,
      asin: true,
    },
  });

  const missingCogsUnits = recentItems.reduce((sum, item) => {
    const hasCost =
      (item.sku ? cogsSkus.has(item.sku) : false) ||
      (item.asin ? cogsAsins.has(item.asin) : false);

    return hasCost ? sum : sum + Math.max(item.quantityOrdered, 0);
  }, 0);

  if (missingCogsUnits > 0) {
    alerts.push({
      id: "missing-cogs",
      level: "warning",
      title: "Missing COGS coverage",
      message: `${missingCogsUnits} units in the last 30 days are missing COGS data.`,
    });
  }

  const sevenDaysAgo = addUtcDays(startOfUtcDay(now), -7);
  const fourteenDaysAgo = addUtcDays(startOfUtcDay(now), -14);
  const refundsCurrent = await prisma.dailySummary.aggregate({
    where: {
      marketplaceId,
      date: {
        gte: sevenDaysAgo,
        lt: now,
      },
    },
    _sum: {
      refunds: true,
    },
  });

  const refundsPrevious = await prisma.dailySummary.aggregate({
    where: {
      marketplaceId,
      date: {
        gte: fourteenDaysAgo,
        lt: sevenDaysAgo,
      },
    },
    _sum: {
      refunds: true,
    },
  });

  const currentRefunds = toNumber(refundsCurrent._sum.refunds);
  const previousRefunds = toNumber(refundsPrevious._sum.refunds);

  if (previousRefunds > 0 && currentRefunds >= previousRefunds * 1.5) {
    alerts.push({
      id: "refund-spike",
      level: "warning",
      title: "Refund spike detected",
      message: `Refunds are ${Math.round((currentRefunds / previousRefunds) * 100)}% of the previous 7-day period.`,
    });
  }

  return alerts;
}

export async function getDashboardKpis(
  marketplaceId?: string,
): Promise<DashboardKpiPayload> {
  const resolvedMarketplaceId = await resolveMarketplaceId(marketplaceId);
  const now = new Date();
  const today = startOfUtcDay(now);
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

  const latestSyncRun = await prisma.syncRun.findFirst({
    where: {
      status: "success",
      marketplaceId: resolvedMarketplaceId,
    },
    orderBy: {
      startedAt: "desc",
    },
    select: {
      finishedAt: true,
      startedAt: true,
    },
  });

  const lastSyncAt = latestSyncRun?.finishedAt ?? latestSyncRun?.startedAt ?? null;
  const dataStale = !lastSyncAt || now.getTime() - lastSyncAt.getTime() > DATA_STALE_THRESHOLD_MS;
  const alerts = await buildDashboardAlerts(resolvedMarketplaceId, now, lastSyncAt);
  const currency = latestOrder?.currency ?? DEFAULT_CURRENCY;

  return {
    marketplaceId: resolvedMarketplaceId,
    currency,
    latestOrderDate: latestOrder ? latestOrder.purchaseDate.toISOString() : null,
    lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
    dataStale,
    alerts,
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

async function buildBaseRows(
  orderItems: Array<
    Prisma.OrderItemGetPayload<{
      include: {
        order: true;
        product: true;
      };
    }>
  >,
): Promise<DashboardOrderItemRow[]> {
  if (orderItems.length === 0) {
    return [];
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
    select: {
      id: true,
      amazonOrderId: true,
      eventType: true,
      amount: true,
    },
  });

  const orderFees = new Map<string, number>();
  const orderRefunds = new Map<string, number>();
  const orderUnits = new Map<string, number>();

  for (const item of orderItems) {
    orderUnits.set(
      item.amazonOrderId,
      (orderUnits.get(item.amazonOrderId) ?? 0) + item.quantityOrdered,
    );
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

  const refundCostByOrderItem = new Map<string, number>();
  for (const allocation of refundAllocations) {
    refundCostByOrderItem.set(
      allocation.orderItemId,
      (refundCostByOrderItem.get(allocation.orderItemId) ?? 0) + toNumber(allocation.amount),
    );
  }

  return orderItems.map((item) => {
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
    const refundCost = refundCostByOrderItem.get(item.id) ?? 0;
    const netProfit = sales - feeShare - cogs - refundCost;

    return {
      id: item.id,
      amazonOrderId: item.amazonOrderId,
      purchaseDate: item.order.purchaseDate.toISOString(),
      productTitle: item.title ?? item.product?.title ?? "Unknown product",
      asin: item.asin,
      sku: item.sku,
      imageUrl: item.product?.imageUrl ?? null,
      unitsSold,
      refunds: Math.max(refundShare, refundCost),
      sales,
      refundCost,
      cogs,
      amazonFees: feeShare,
      netProfit,
    };
  });
}

function groupRows(
  rows: DashboardOrderItemRow[],
  groupBy: Exclude<DashboardGroupBy, "none">,
): DashboardOrderItemRow[] {
  const grouped = new Map<string, DashboardOrderItemRow>();

  for (const row of rows) {
    const key =
      groupBy === "order"
        ? row.amazonOrderId
        : `${row.sku ?? ""}|${row.asin ?? ""}|${row.productTitle}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...row,
        id: `${groupBy}-${key}`,
        amazonOrderId: groupBy === "order" ? row.amazonOrderId : "GROUPED-PRODUCT",
      });
      continue;
    }

    const newerPurchaseDate =
      new Date(row.purchaseDate).getTime() > new Date(existing.purchaseDate).getTime()
        ? row.purchaseDate
        : existing.purchaseDate;

    grouped.set(key, {
      ...existing,
      purchaseDate: newerPurchaseDate,
      unitsSold: existing.unitsSold + row.unitsSold,
      refunds: existing.refunds + row.refunds,
      sales: existing.sales + row.sales,
      refundCost: existing.refundCost + row.refundCost,
      cogs: existing.cogs + row.cogs,
      amazonFees: existing.amazonFees + row.amazonFees,
      netProfit: existing.netProfit + row.netProfit,
      productTitle:
        groupBy === "order" ? `${existing.productTitle} + ${row.productTitle}` : existing.productTitle,
      asin: groupBy === "order" ? null : existing.asin,
      sku: groupBy === "order" ? null : existing.sku,
      imageUrl: existing.imageUrl ?? row.imageUrl,
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const dateDelta = new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime();
    if (dateDelta !== 0) {
      return dateDelta;
    }
    return b.netProfit - a.netProfit;
  });
}

function resolveGroupBy(input: DashboardGroupBy | undefined): DashboardGroupBy {
  return input === "order" || input === "product" ? input : "none";
}

export async function getDashboardOrderItems(params: {
  range: DashboardRangeInput;
  search?: string;
  marketplaceId?: string;
  groupBy?: DashboardGroupBy;
  page?: number;
  pageSize?: number;
}): Promise<DashboardOrderItemsPayload> {
  const resolvedMarketplaceId = await resolveMarketplaceId(params.marketplaceId);
  const resolvedRange = resolveDashboardRange(params.range);
  const search = normalizeSearchTerm(params.search);
  const groupBy = resolveGroupBy(params.groupBy);
  const pageSize = clampPositiveInt(params.pageSize, DEFAULT_PAGE_SIZE);
  const page = clampPositiveInt(params.page, 1);

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

  const baseQuery = {
    where,
    include: {
      order: true,
      product: true,
    },
    orderBy: [
      {
        order: {
          purchaseDate: "desc" as const,
        },
      },
      {
        id: "desc" as const,
      },
    ],
  };

  if (groupBy === "none") {
    const totalRows = await prisma.orderItem.count({ where });
    const totalPages = Math.max(Math.ceil(totalRows / pageSize), 1);
    const safePage = Math.min(page, totalPages);

    const orderItems = await prisma.orderItem.findMany({
      ...baseQuery,
      skip: (safePage - 1) * pageSize,
      take: pageSize,
    });

    const rows = await buildBaseRows(orderItems);

    return {
      rows,
      marketplaceId: resolvedMarketplaceId,
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
      groupBy,
    };
  }

  const orderItems = await prisma.orderItem.findMany({
    ...baseQuery,
    take: GROUPED_FETCH_LIMIT,
  });

  const groupedRows = groupRows(await buildBaseRows(orderItems), groupBy);
  const totalRows = groupedRows.length;
  const totalPages = Math.max(Math.ceil(totalRows / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  return {
    rows: groupedRows.slice(offset, offset + pageSize),
    marketplaceId: resolvedMarketplaceId,
    page: safePage,
    pageSize,
    totalRows,
    totalPages,
    groupBy,
  };
}
