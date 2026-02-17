import { Prisma } from "@prisma/client";
import type { OrderItem } from "@sp-api-sdk/orders-api-v0";

import { prisma } from "@/lib/db";
import { resolveSpApiConfig } from "@/lib/sp-api/config";
import { fetchOrdersWithItems } from "@/lib/sp-api/orders";

export interface SyncOrdersOptions {
  days?: number;
  marketplaceId?: string;
}

export interface SyncOrdersResult {
  marketplaceId: string;
  createdAfter: string;
  ordersFetched: number;
  ordersUpserted: number;
  orderItemsUpserted: number;
  productsUpserted: number;
}

function parseMoneyAmount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function subtractDays(date: Date, days: number): Date {
  const output = new Date(date);
  output.setUTCDate(output.getUTCDate() - days);
  return output;
}

async function upsertProductFromOrderItem(
  tx: Prisma.TransactionClient,
  orderItem: OrderItem,
): Promise<string | undefined> {
  const asin = orderItem.ASIN?.trim();
  const sku = orderItem.SellerSKU?.trim();
  const title = orderItem.Title?.trim();

  if (!asin && !sku) {
    return undefined;
  }

  let existing = asin ? await tx.product.findUnique({ where: { asin } }) : null;

  if (!existing && sku) {
    existing = await tx.product.findUnique({ where: { sku } });
  }

  if (existing) {
    const updates: Prisma.ProductUpdateInput = {};

    if (title) {
      updates.title = title;
    }

    if (!existing.asin && asin) {
      updates.asin = asin;
    }

    if (!existing.sku && sku) {
      updates.sku = sku;
    }

    if (Object.keys(updates).length === 0) {
      return existing.id;
    }

    try {
      const updated = await tx.product.update({
        where: { id: existing.id },
        data: updates,
      });

      return updated.id;
    } catch {
      return existing.id;
    }
  }

  try {
    const created = await tx.product.create({
      data: {
        asin: asin ?? null,
        sku: sku ?? null,
        title: title ?? null,
      },
    });

    return created.id;
  } catch {
    const fallback =
      (asin ? await tx.product.findUnique({ where: { asin } }) : null) ??
      (sku ? await tx.product.findUnique({ where: { sku } }) : null);

    return fallback?.id;
  }
}

export async function syncOrdersFromSpApi({
  days = 30,
  marketplaceId,
}: SyncOrdersOptions = {}): Promise<SyncOrdersResult> {
  const config = await resolveSpApiConfig({ marketplaceId });

  const createdAfter = subtractDays(new Date(), Math.max(days, 1));
  const createdBefore = new Date(Date.now() - 2 * 60 * 1000);

  const entries = await fetchOrdersWithItems({
    config,
    createdAfter,
    createdBefore,
  });

  let ordersUpserted = 0;
  let orderItemsUpserted = 0;
  let productsUpserted = 0;

  for (const entry of entries) {
    await prisma.$transaction(async (tx) => {
      const order = entry.order;

      const purchaseDate = new Date(order.PurchaseDate);

      if (Number.isNaN(purchaseDate.getTime())) {
        return;
      }

      const amount = parseMoneyAmount(order.OrderTotal?.Amount);

      const persistedOrder = await tx.order.upsert({
        where: {
          amazonOrderId: order.AmazonOrderId,
        },
        update: {
          purchaseDate,
          orderStatus: order.OrderStatus,
          marketplaceId: order.MarketplaceId ?? config.marketplaceId,
          buyerCountry: order.ShippingAddress?.CountryCode,
          totalAmount: amount,
          currency: order.OrderTotal?.CurrencyCode ?? null,
          connectionId: config.connectionId,
        },
        create: {
          amazonOrderId: order.AmazonOrderId,
          purchaseDate,
          orderStatus: order.OrderStatus,
          marketplaceId: order.MarketplaceId ?? config.marketplaceId,
          buyerCountry: order.ShippingAddress?.CountryCode,
          totalAmount: amount,
          currency: order.OrderTotal?.CurrencyCode ?? null,
          connectionId: config.connectionId,
        },
      });

      await tx.orderItem.deleteMany({
        where: {
          amazonOrderId: persistedOrder.amazonOrderId,
        },
      });

      for (const item of entry.items) {
        const productId = await upsertProductFromOrderItem(tx, item);

        if (productId) {
          productsUpserted += 1;
        }

        await tx.orderItem.create({
          data: {
            amazonOrderId: persistedOrder.amazonOrderId,
            asin: item.ASIN,
            sku: item.SellerSKU,
            title: item.Title,
            quantityOrdered: item.QuantityOrdered,
            itemPrice: parseMoneyAmount(item.ItemPrice?.Amount),
            itemTax: parseMoneyAmount(item.ItemTax?.Amount),
            promotionDiscount: parseMoneyAmount(item.PromotionDiscount?.Amount),
            isRefunded: false,
            productId,
          },
        });

        orderItemsUpserted += 1;
      }

      ordersUpserted += 1;
    });
  }

  return {
    marketplaceId: config.marketplaceId,
    createdAfter: createdAfter.toISOString(),
    ordersFetched: entries.length,
    ordersUpserted,
    orderItemsUpserted,
    productsUpserted,
  };
}
