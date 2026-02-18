import type { Order, OrderItem } from "@sp-api-sdk/orders-api-v0";

import { createOrdersClient } from "@/lib/sp-api/client";
import { withSpApiRetry } from "@/lib/sp-api/retry";
import type { SpApiConnectionConfig } from "@/lib/sp-api/types";

export interface SpApiOrderWithItems {
  order: Order;
  items: OrderItem[];
}

interface FetchOrdersWithItemsInput {
  config: SpApiConnectionConfig;
  createdAfter: Date;
  createdBefore?: Date;
  maxPages?: number;
  maxOrders?: number;
  maxOrdersWithItems?: number;
}

export interface OrdersFetchDiagnostics {
  pagesFetched: number;
  pageLimitHit: boolean;
  orderLimitHit: boolean;
  totalOrdersFetched: number;
  uniqueOrdersFetched: number;
  ordersWithItemsFetched: number;
  ordersSkippedForItems: number;
  maxPages: number;
  maxOrders: number;
  maxOrdersWithItems: number;
}

export interface FetchOrdersWithItemsResult {
  entries: SpApiOrderWithItems[];
  diagnostics: OrdersFetchDiagnostics;
}

async function fetchOrderItemsForOrder(
  client: ReturnType<typeof createOrdersClient>,
  orderId: string,
): Promise<OrderItem[]> {
  const items: OrderItem[] = [];
  let nextToken: string | undefined;

  do {
    const response = await withSpApiRetry(
      () =>
        client.getOrderItems({
          orderId,
          nextToken,
        }),
      {
        attempts: 4,
        baseDelayMs: 2500,
      },
    );

    const payload = response.data.payload;
    const orderItems = payload?.OrderItems ?? [];

    if (orderItems.length > 0) {
      items.push(...orderItems);
    }

    nextToken = payload?.NextToken;
  } while (nextToken);

  return items;
}

export async function fetchOrdersWithItems({
  config,
  createdAfter,
  createdBefore,
  maxPages = 10,
  maxOrders = 2000,
  maxOrdersWithItems = 1000,
}: FetchOrdersWithItemsInput): Promise<FetchOrdersWithItemsResult> {
  const client = createOrdersClient(config);

  const orders: Order[] = [];
  let nextToken: string | undefined;
  let pagesFetched = 0;

  let orderLimitHit = false;

  do {
    const response = await withSpApiRetry(
      () =>
        client.getOrders({
          marketplaceIds: [config.marketplaceId],
          createdAfter: createdAfter.toISOString(),
          ...(createdBefore ? { createdBefore: createdBefore.toISOString() } : {}),
          maxResultsPerPage: 100,
          nextToken,
        }),
      {
        attempts: 4,
        baseDelayMs: 4000,
      },
    );

    const payload = response.data.payload;
    const pageOrders = payload?.Orders ?? [];

    if (pageOrders.length > 0) {
      orders.push(...pageOrders);
    }

    nextToken = payload?.NextToken;
    pagesFetched += 1;

    if (orders.length >= maxOrders) {
      orderLimitHit = true;
      break;
    }
  } while (nextToken && pagesFetched < maxPages);

  const uniqueOrders = new Map<string, Order>();

  for (const order of orders) {
    uniqueOrders.set(order.AmazonOrderId, order);
  }

  const sortedOrders = [...uniqueOrders.values()].sort((a, b) => {
    return new Date(b.PurchaseDate).getTime() - new Date(a.PurchaseDate).getTime();
  });

  const entries: SpApiOrderWithItems[] = [];

  let ordersWithItemsFetched = 0;

  for (let index = 0; index < sortedOrders.length; index += 1) {
    const order = sortedOrders[index]!;

    if (index >= maxOrdersWithItems) {
      entries.push({ order, items: [] });
      continue;
    }

    let items: OrderItem[] = [];

    try {
      items = await fetchOrderItemsForOrder(client, order.AmazonOrderId);
    } catch {
      // Keep the order record even when order-item calls are rate-limited.
      items = [];
    }

    entries.push({ order, items });
    ordersWithItemsFetched += 1;
  }

  return {
    entries,
    diagnostics: {
      pagesFetched,
      pageLimitHit: Boolean(nextToken && pagesFetched >= maxPages),
      orderLimitHit,
      totalOrdersFetched: orders.length,
      uniqueOrdersFetched: sortedOrders.length,
      ordersWithItemsFetched,
      ordersSkippedForItems: Math.max(sortedOrders.length - ordersWithItemsFetched, 0),
      maxPages,
      maxOrders,
      maxOrdersWithItems,
    },
  };
}
