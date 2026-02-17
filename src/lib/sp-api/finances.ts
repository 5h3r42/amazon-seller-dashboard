import { createHash } from "node:crypto";

import { createFinancesClient } from "@/lib/sp-api/client";
import { withSpApiRetry } from "@/lib/sp-api/retry";
import type {
  FlattenedFinancialEvent,
  SpApiConnectionConfig,
} from "@/lib/sp-api/types";

interface FetchFinancialEventsInput {
  config: SpApiConnectionConfig;
  postedAfter: Date;
  postedBefore?: Date;
  maxPages?: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function maybeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function collectCurrencyNodes(
  value: unknown,
  output: Array<{ amount: number; currency?: string }>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCurrencyNodes(item, output);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  const maybeAmount = maybeNumber(record.CurrencyAmount);

  if (typeof maybeAmount === "number") {
    output.push({
      amount: maybeAmount,
      currency:
        typeof record.CurrencyCode === "string" ? record.CurrencyCode : undefined,
    });
  }

  for (const nested of Object.values(record)) {
    collectCurrencyNodes(nested, output);
  }
}

function findStringByKey(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const candidate = record[key];
  if (typeof candidate === "string") {
    return candidate;
  }

  for (const nested of Object.values(record)) {
    const found = findStringByKey(nested, key);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findDate(value: unknown): Date {
  const postedDate = findStringByKey(value, "PostedDate");

  if (postedDate) {
    const parsed = new Date(postedDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function buildEventKey(input: {
  eventType: string;
  postedDate: Date;
  amazonOrderId?: string;
  sku?: string;
  asin?: string;
  amount: number;
  currency: string;
  index: number;
}): string {
  const seed = [
    input.eventType,
    input.postedDate.toISOString(),
    input.amazonOrderId ?? "",
    input.sku ?? "",
    input.asin ?? "",
    input.amount.toFixed(6),
    input.currency,
    String(input.index),
  ].join("|");

  return createHash("sha1").update(seed).digest("hex");
}

function normalizeEventType(listKey: string): string {
  return listKey.replace(/List$/, "");
}

function flattenSingleEvent(
  listKey: string,
  eventPayload: unknown,
  index: number,
): FlattenedFinancialEvent | undefined {
  const currencyNodes: Array<{ amount: number; currency?: string }> = [];
  collectCurrencyNodes(eventPayload, currencyNodes);

  if (currencyNodes.length === 0) {
    return undefined;
  }

  const amount = currencyNodes.reduce((sum, node) => sum + node.amount, 0);
  const currency =
    currencyNodes.find((node) => typeof node.currency === "string")?.currency ?? "GBP";

  const postedDate = findDate(eventPayload);
  const amazonOrderId = findStringByKey(eventPayload, "AmazonOrderId");
  const sku = findStringByKey(eventPayload, "SellerSKU");
  const asin = findStringByKey(eventPayload, "ASIN");
  const eventType = normalizeEventType(listKey);

  return {
    eventKey: buildEventKey({
      eventType,
      postedDate,
      amazonOrderId,
      sku,
      asin,
      amount,
      currency,
      index,
    }),
    postedDate,
    eventType,
    amount,
    currency,
    amazonOrderId,
    sku,
    asin,
    rawJson: JSON.stringify(eventPayload),
  };
}

function flattenFinancialEvents(financialEvents: unknown): FlattenedFinancialEvent[] {
  const record = asRecord(financialEvents);

  if (!record) {
    return [];
  }

  const flattened: FlattenedFinancialEvent[] = [];

  for (const [listKey, entries] of Object.entries(record)) {
    const items = asArray(entries);

    items.forEach((entry, index) => {
      const flattenedEvent = flattenSingleEvent(listKey, entry, index);
      if (flattenedEvent) {
        flattened.push(flattenedEvent);
      }
    });
  }

  return flattened;
}

export async function fetchFinancialEvents({
  config,
  postedAfter,
  postedBefore,
  maxPages = 2,
}: FetchFinancialEventsInput): Promise<FlattenedFinancialEvent[]> {
  const client = createFinancesClient(config);

  const events: FlattenedFinancialEvent[] = [];
  let nextToken: string | undefined;
  let pagesFetched = 0;

  do {
    const response = await withSpApiRetry(
      () =>
        client.listFinancialEvents({
          maxResultsPerPage: 100,
          postedAfter: postedAfter.toISOString(),
          ...(postedBefore ? { postedBefore: postedBefore.toISOString() } : {}),
          nextToken,
        }),
      {
        attempts: 4,
        baseDelayMs: 2500,
      },
    );

    const payload = response.data.payload;
    const flattenedPageEvents = flattenFinancialEvents(payload?.FinancialEvents);

    if (flattenedPageEvents.length > 0) {
      events.push(...flattenedPageEvents);
    }

    nextToken = payload?.NextToken;
    pagesFetched += 1;
  } while (nextToken && pagesFetched < maxPages);

  const deduped = new Map<string, FlattenedFinancialEvent>();

  for (const event of events) {
    deduped.set(event.eventKey, event);
  }

  return [...deduped.values()];
}
