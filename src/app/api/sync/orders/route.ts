import { NextResponse } from "next/server";
import { z } from "zod";

import { ConfigError } from "@/lib/env";
import { getRequestId, logStructured } from "@/lib/http/requestMeta";
import { syncOrdersFromSpApi } from "@/lib/sync/ordersSync";
import { finishSyncRunLog, startSyncRunLog } from "@/lib/sync/syncRunLog";

export const runtime = "nodejs";

const syncSchema = z.object({
  days: z.number().int().min(1).max(180).optional(),
  marketplaceId: z.string().trim().min(1).optional(),
  maxPages: z.number().int().min(1).max(100).optional(),
  maxOrders: z.number().int().min(1).max(5000).optional(),
  maxOrdersWithItems: z.number().int().min(1).max(5000).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let syncRunId: string | null = null;

  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const payload = syncSchema.parse(json);
    syncRunId = await startSyncRunLog({
      runType: "orders",
      requestId,
      marketplaceId: payload.marketplaceId,
      days: payload.days,
      dryRun: payload.dryRun,
    });

    logStructured("orders_sync_started", {
      requestId,
      days: payload.days,
      marketplaceId: payload.marketplaceId,
      dryRun: payload.dryRun ?? false,
    });

    const result = await syncOrdersFromSpApi({
      days: payload.days,
      marketplaceId: payload.marketplaceId,
      maxPages: payload.maxPages,
      maxOrders: payload.maxOrders,
      maxOrdersWithItems: payload.maxOrdersWithItems,
      dryRun: payload.dryRun,
    });

    const warnings: string[] = [];

    if (result.diagnostics.pageLimitHit) {
      warnings.push("Orders page limit reached before exhausting upstream pages.");
    }
    if (result.diagnostics.ordersSkippedForItems > 0) {
      warnings.push(
        `Skipped order-item fetch for ${result.diagnostics.ordersSkippedForItems} orders due to maxOrdersWithItems.`,
      );
    }

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: true,
        warnings,
        marketplaceId: result.marketplaceId,
      });
    }

    logStructured("orders_sync_completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      warningsCount: warnings.length,
      diagnostics: result.diagnostics,
      dryRun: result.dryRun,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        result,
        warnings,
        limitsApplied: {
          maxPages: result.diagnostics.maxPages,
          maxOrders: result.diagnostics.maxOrders,
          maxOrdersWithItems: result.diagnostics.maxOrdersWithItems,
        },
        truncationFlags: {
          orderPageLimitHit: result.diagnostics.pageLimitHit,
          ordersSkippedForItems: result.diagnostics.ordersSkippedForItems > 0,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync orders";

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: false,
        errorMessage: message,
      });
    }

    logStructured("orders_sync_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      message,
    });

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: error.issues.map((issue) => issue.message).join(", "),
          },
          requestId,
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
          requestId,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message,
        },
        requestId,
      },
      { status: 500 },
    );
  }
}
