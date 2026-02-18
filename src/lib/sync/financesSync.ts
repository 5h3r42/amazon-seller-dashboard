import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { resolveSpApiConfig } from "@/lib/sp-api/config";
import { fetchFinancialEvents } from "@/lib/sp-api/finances";

export interface SyncFinancesOptions {
  days?: number;
  marketplaceId?: string;
  maxEventsPages?: number;
  dryRun?: boolean;
}

export interface SyncFinancesResult {
  marketplaceId: string;
  postedAfter: string;
  dryRun: boolean;
  eventsFetched: number;
  eventsUpserted: number;
  orderItemsMarkedRefunded: number;
  refundAllocationsUpserted: number;
  diagnostics: {
    pagesFetched: number;
    eventPageLimitHit: boolean;
    eventsBeforeDedup: number;
    eventsAfterDedup: number;
    maxPages: number;
  };
}

function subtractDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() - days);
  return output;
}

function isRefundEventType(eventType: string): boolean {
  const normalized = eventType.toUpperCase();
  return (
    normalized.includes("REFUND") ||
    normalized.includes("CHARGEBACK") ||
    normalized.includes("GUARANTEE")
  );
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

function computeOrderItemWeight(item: {
  quantityOrdered: number;
  itemPrice: Prisma.Decimal | null;
  itemTax: Prisma.Decimal | null;
  promotionDiscount: Prisma.Decimal | null;
}): number {
  const gross =
    item.quantityOrdered * toNumber(item.itemPrice) +
    toNumber(item.itemTax) -
    Math.abs(toNumber(item.promotionDiscount));

  if (gross > 0) {
    return gross;
  }

  return item.quantityOrdered > 0 ? item.quantityOrdered : 1;
}

function allocateRefundAmount(
  amount: number,
  items: Array<{
    id: string;
    quantityOrdered: number;
    itemPrice: Prisma.Decimal | null;
    itemTax: Prisma.Decimal | null;
    promotionDiscount: Prisma.Decimal | null;
  }>,
): Array<{ orderItemId: string; amount: number }> {
  if (items.length === 0 || amount <= 0) {
    return [];
  }

  const weighted = items.map((item) => ({
    id: item.id,
    weight: computeOrderItemWeight(item),
  }));

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return [];
  }

  let remaining = amount;

  return weighted.map((item, index) => {
    if (index === weighted.length - 1) {
      return {
        orderItemId: item.id,
        amount: Number(Math.max(remaining, 0).toFixed(6)),
      };
    }

    const share = Number(((amount * item.weight) / totalWeight).toFixed(6));
    remaining -= share;

    return {
      orderItemId: item.id,
      amount: share,
    };
  });
}

export async function syncFinancesFromSpApi({
  days = 30,
  marketplaceId,
  maxEventsPages,
  dryRun = false,
}: SyncFinancesOptions = {}): Promise<SyncFinancesResult> {
  const config = await resolveSpApiConfig({ marketplaceId });

  const postedAfter = subtractDays(new Date(), Math.max(days, 1));
  const postedBefore = new Date(Date.now() - 2 * 60 * 1000);

  const fetchResult = await fetchFinancialEvents({
    config,
    postedAfter,
    postedBefore,
    maxPages: maxEventsPages,
  });
  const events = fetchResult.events;

  let eventsUpserted = 0;
  let orderItemsMarkedRefunded = 0;
  let refundAllocationsUpserted = 0;

  const uniqueOrderIds = [
    ...new Set(
      events
        .map((event) => event.amazonOrderId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const knownOrders = await prisma.order.findMany({
    where: {
      amazonOrderId: {
        in: uniqueOrderIds,
      },
    },
    select: {
      amazonOrderId: true,
    },
  });
  const knownOrderIdSet = new Set(knownOrders.map((order) => order.amazonOrderId));
  const knownOrderIds = [...knownOrderIdSet];

  const orderItems = knownOrderIds.length
    ? await prisma.orderItem.findMany({
        where: {
          amazonOrderId: {
            in: knownOrderIds,
          },
        },
        select: {
          id: true,
          amazonOrderId: true,
          quantityOrdered: true,
          itemPrice: true,
          itemTax: true,
          promotionDiscount: true,
        },
      })
    : [];

  const orderItemsByOrderId = new Map<string, typeof orderItems>();

  for (const item of orderItems) {
    const current = orderItemsByOrderId.get(item.amazonOrderId) ?? [];
    current.push(item);
    orderItemsByOrderId.set(item.amazonOrderId, current);
  }

  for (const event of events) {
    const safeAmazonOrderId =
      event.amazonOrderId && knownOrderIdSet.has(event.amazonOrderId)
        ? event.amazonOrderId
        : null;

    const allocations =
      safeAmazonOrderId && isRefundEventType(event.eventType)
        ? allocateRefundAmount(
            Math.abs(event.amount),
            orderItemsByOrderId.get(safeAmazonOrderId) ?? [],
          )
        : [];

    if (!dryRun) {
      const financialEvent = await prisma.financialEvent.upsert({
        where: {
          eventKey: event.eventKey,
        },
        update: {
          postedDate: event.postedDate,
          eventType: event.eventType,
          amount: event.amount,
          currency: event.currency,
          marketplaceId: config.marketplaceId,
          amazonOrderId: safeAmazonOrderId,
          asin: event.asin,
          sku: event.sku,
          rawJson: event.rawJson,
        },
        create: {
          eventKey: event.eventKey,
          postedDate: event.postedDate,
          eventType: event.eventType,
          amount: event.amount,
          currency: event.currency,
          marketplaceId: config.marketplaceId,
          amazonOrderId: safeAmazonOrderId,
          asin: event.asin,
          sku: event.sku,
          rawJson: event.rawJson,
        },
        select: {
          id: true,
        },
      });

      if (allocations.length > 0) {
        await prisma.refundAllocation.deleteMany({
          where: {
            financialEventId: financialEvent.id,
          },
        });

        await prisma.refundAllocation.createMany({
          data: allocations.map((allocation) => ({
            financialEventId: financialEvent.id,
            orderItemId: allocation.orderItemId,
            amount: allocation.amount,
            currency: event.currency,
          })),
        });

        const updated = await prisma.orderItem.updateMany({
          where: {
            id: {
              in: allocations.map((allocation) => allocation.orderItemId),
            },
          },
          data: {
            isRefunded: true,
          },
        });

        orderItemsMarkedRefunded += updated.count;
        refundAllocationsUpserted += allocations.length;
      } else {
        await prisma.refundAllocation.deleteMany({
          where: {
            financialEventId: financialEvent.id,
          },
        });
      }
    } else if (allocations.length > 0) {
      orderItemsMarkedRefunded += allocations.length;
      refundAllocationsUpserted += allocations.length;
    }

    eventsUpserted += 1;
  }

  return {
    marketplaceId: config.marketplaceId,
    postedAfter: postedAfter.toISOString(),
    dryRun,
    eventsFetched: events.length,
    eventsUpserted,
    orderItemsMarkedRefunded,
    refundAllocationsUpserted,
    diagnostics: fetchResult.diagnostics,
  };
}
