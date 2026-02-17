import { Prisma } from "@prisma/client";

import { ConfigError } from "@/lib/env";
import { prisma } from "@/lib/db";

export interface RecomputeDailySummaryOptions {
  days?: number;
  marketplaceId?: string;
}

export interface RecomputeDailySummaryResult {
  marketplaceId: string;
  startDate: string;
  endDate: string;
  summariesWritten: number;
  missingCogsItems: number;
}

interface DailyAccumulator {
  sales: number;
  ordersCount: number;
  units: number;
  refunds: number;
  amazonFees: number;
  otherFees: number;
  netPayout: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() + days);
  return output;
}

function toDateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function fromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function subtractDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() - days);
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

function ensureAccumulator(
  map: Map<string, DailyAccumulator>,
  dateKey: string,
): DailyAccumulator {
  const existing = map.get(dateKey);
  if (existing) {
    return existing;
  }

  const created: DailyAccumulator = {
    sales: 0,
    ordersCount: 0,
    units: 0,
    refunds: 0,
    amazonFees: 0,
    otherFees: 0,
    netPayout: 0,
    cogs: 0,
    grossProfit: 0,
    netProfit: 0,
  };

  map.set(dateKey, created);
  return created;
}

function classifyEvent(eventType: string): {
  refund: boolean;
  amazonFee: boolean;
  otherFee: boolean;
  payout: boolean;
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
    otherFee:
      normalized.includes("PRODUCTADS") ||
      normalized.includes("COUPON") ||
      normalized.includes("AFFORDABILITY") ||
      normalized.includes("SELLERDEAL") ||
      normalized.includes("SELLERREVIEWENROLLMENT"),
    payout:
      normalized.includes("ADHOCDISBURSEMENT") || normalized.includes("PAYWITHAMAZON"),
  };
}

async function resolveMarketplaceId(input?: string): Promise<string> {
  if (input?.trim()) {
    return input.trim();
  }

  const latestConnection = await prisma.amazonConnection.findFirst({
    orderBy: {
      createdAt: "desc",
    },
  });

  if (latestConnection?.marketplaceId) {
    return latestConnection.marketplaceId;
  }

  const envMarketplace = process.env.SP_API_MARKETPLACE_ID?.trim();

  if (envMarketplace) {
    return envMarketplace;
  }

  throw new ConfigError(
    "Missing marketplaceId. Save an Amazon connection or set SP_API_MARKETPLACE_ID.",
  );
}

export async function recomputeDailySummary({
  days = 30,
  marketplaceId,
}: RecomputeDailySummaryOptions = {}): Promise<RecomputeDailySummaryResult> {
  const resolvedMarketplaceId = await resolveMarketplaceId(marketplaceId);

  const today = startOfUtcDay(new Date());
  const startDate = startOfUtcDay(subtractDays(today, Math.max(days, 1) - 1));
  const endExclusive = addUtcDays(today, 1);

  const orders = await prisma.order.findMany({
    where: {
      marketplaceId: resolvedMarketplaceId,
      purchaseDate: {
        gte: startDate,
        lt: endExclusive,
      },
    },
    include: {
      items: true,
    },
  });

  const orderIdSet = new Set(orders.map((order) => order.amazonOrderId));

  const financialEvents = await prisma.financialEvent.findMany({
    where: {
      postedDate: {
        gte: startDate,
        lt: endExclusive,
      },
    },
  });

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

  const dayMap = new Map<string, DailyAccumulator>();
  let missingCogsItems = 0;

  for (const order of orders) {
    const dateKey = toDateKey(order.purchaseDate);
    const accumulator = ensureAccumulator(dayMap, dateKey);

    accumulator.ordersCount += 1;

    if (order.items.length === 0) {
      accumulator.sales += toNumber(order.totalAmount);
      continue;
    }

    for (const item of order.items) {
      const quantity = item.quantityOrdered;
      const itemPrice = toNumber(item.itemPrice);
      const itemTax = toNumber(item.itemTax);
      const discount = Math.abs(toNumber(item.promotionDiscount));

      accumulator.sales += itemPrice * quantity + itemTax - discount;
      accumulator.units += quantity;

      const unitCost =
        (item.sku ? cogsBySku.get(item.sku) : undefined) ??
        (item.asin ? cogsByAsin.get(item.asin) : undefined) ??
        0;

      if (unitCost === 0 && quantity > 0 && (item.sku || item.asin)) {
        missingCogsItems += quantity;
      }

      accumulator.cogs += unitCost * quantity;
    }
  }

  for (const event of financialEvents) {
    if (
      event.marketplaceId &&
      event.marketplaceId !== resolvedMarketplaceId &&
      (!event.amazonOrderId || !orderIdSet.has(event.amazonOrderId))
    ) {
      continue;
    }

    const dateKey = toDateKey(event.postedDate);
    const accumulator = ensureAccumulator(dayMap, dateKey);
    const amount = toNumber(event.amount);
    const absoluteAmount = Math.abs(amount);

    const classification = classifyEvent(event.eventType);

    if (classification.refund) {
      accumulator.refunds += absoluteAmount;
    }

    if (classification.amazonFee) {
      accumulator.amazonFees += absoluteAmount;
    }

    if (classification.otherFee) {
      accumulator.otherFees += absoluteAmount;
    }

    if (classification.payout) {
      accumulator.netPayout += amount;
    }
  }

  let summariesWritten = 0;

  for (const [dateKey, accumulator] of dayMap.entries()) {
    accumulator.grossProfit = accumulator.sales - accumulator.amazonFees - accumulator.cogs;
    accumulator.netProfit = accumulator.grossProfit - accumulator.otherFees;

    await prisma.dailySummary.upsert({
      where: {
        date_marketplaceId: {
          date: fromDateKey(dateKey),
          marketplaceId: resolvedMarketplaceId,
        },
      },
      update: {
        sales: accumulator.sales,
        ordersCount: accumulator.ordersCount,
        units: accumulator.units,
        refunds: accumulator.refunds,
        amazonFees: accumulator.amazonFees,
        otherFees: accumulator.otherFees,
        netPayout: accumulator.netPayout,
        cogs: accumulator.cogs,
        grossProfit: accumulator.grossProfit,
        netProfit: accumulator.netProfit,
      },
      create: {
        date: fromDateKey(dateKey),
        marketplaceId: resolvedMarketplaceId,
        sales: accumulator.sales,
        ordersCount: accumulator.ordersCount,
        units: accumulator.units,
        refunds: accumulator.refunds,
        amazonFees: accumulator.amazonFees,
        otherFees: accumulator.otherFees,
        netPayout: accumulator.netPayout,
        cogs: accumulator.cogs,
        grossProfit: accumulator.grossProfit,
        netProfit: accumulator.netProfit,
      },
    });

    summariesWritten += 1;
  }

  return {
    marketplaceId: resolvedMarketplaceId,
    startDate: startDate.toISOString(),
    endDate: today.toISOString(),
    summariesWritten,
    missingCogsItems,
  };
}
