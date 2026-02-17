import { NextResponse } from "next/server";
import { z } from "zod";

import { ConfigError } from "@/lib/env";
import { recomputeDailySummary } from "@/lib/metrics/dailySummary";
import { syncFinancesFromSpApi } from "@/lib/sync/financesSync";
import { syncOrdersFromSpApi } from "@/lib/sync/ordersSync";

export const runtime = "nodejs";

const syncSchema = z.object({
  days: z.number().int().min(1).max(180).optional(),
  marketplaceId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const payload = syncSchema.parse(json);

    const days = payload.days ?? 120;

    const orders = await syncOrdersFromSpApi({
      days,
      marketplaceId: payload.marketplaceId,
    });

    const finances = await syncFinancesFromSpApi({
      days,
      marketplaceId: payload.marketplaceId ?? orders.marketplaceId,
    });

    const summary = await recomputeDailySummary({
      days,
      marketplaceId: payload.marketplaceId ?? orders.marketplaceId,
    });

    return NextResponse.json(
      {
        ok: true,
        result: {
          orders,
          finances,
          summary,
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

    if (error instanceof ConfigError) {
      return NextResponse.json(
        {
          error: {
            code: "CONFIG_ERROR",
            message: error.message,
          },
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Failed to run sync job";

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
