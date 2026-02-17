import { prisma } from "@/lib/db";
import { resolveSpApiConfig } from "@/lib/sp-api/config";
import { fetchFinancialEvents } from "@/lib/sp-api/finances";

export interface SyncFinancesOptions {
  days?: number;
  marketplaceId?: string;
}

export interface SyncFinancesResult {
  marketplaceId: string;
  postedAfter: string;
  eventsFetched: number;
  eventsUpserted: number;
  ordersMarkedRefunded: number;
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

export async function syncFinancesFromSpApi({
  days = 30,
  marketplaceId,
}: SyncFinancesOptions = {}): Promise<SyncFinancesResult> {
  const config = await resolveSpApiConfig({ marketplaceId });

  const postedAfter = subtractDays(new Date(), Math.max(days, 1));
  const postedBefore = new Date(Date.now() - 2 * 60 * 1000);

  const events = await fetchFinancialEvents({
    config,
    postedAfter,
    postedBefore,
  });

  let eventsUpserted = 0;
  const refundOrderIds = new Set<string>();

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

  for (const event of events) {
    const safeAmazonOrderId =
      event.amazonOrderId && knownOrderIdSet.has(event.amazonOrderId)
        ? event.amazonOrderId
        : null;

    await prisma.financialEvent.upsert({
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
    });

    if (safeAmazonOrderId && isRefundEventType(event.eventType)) {
      refundOrderIds.add(safeAmazonOrderId);
    }

    eventsUpserted += 1;
  }

  let ordersMarkedRefunded = 0;

  if (refundOrderIds.size > 0) {
    const updated = await prisma.orderItem.updateMany({
      where: {
        amazonOrderId: {
          in: [...refundOrderIds],
        },
      },
      data: {
        isRefunded: true,
      },
    });

    ordersMarkedRefunded = updated.count;
  }

  return {
    marketplaceId: config.marketplaceId,
    postedAfter: postedAfter.toISOString(),
    eventsFetched: events.length,
    eventsUpserted,
    ordersMarkedRefunded,
  };
}
