import { NextResponse } from "next/server";
import { z } from "zod";

import { ConfigError } from "@/lib/env";
import { getRequestId, logStructured } from "@/lib/http/requestMeta";
import { recomputeDailySummary } from "@/lib/metrics/dailySummary";
import { syncFinancesFromSpApi } from "@/lib/sync/financesSync";
import { syncOrdersFromSpApi } from "@/lib/sync/ordersSync";
import { finishSyncRunLog, startSyncRunLog } from "@/lib/sync/syncRunLog";

export const runtime = "nodejs";

const syncSchema = z.object({
  days: z.number().int().min(1).max(180).optional(),
  marketplaceId: z.string().trim().min(1).optional(),
  maxPages: z.number().int().min(1).max(100).optional(),
  maxOrders: z.number().int().min(1).max(5000).optional(),
  maxOrdersWithItems: z.number().int().min(1).max(5000).optional(),
  maxEventsPages: z.number().int().min(1).max(100).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let syncRunId: string | null = null;

  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const payload = syncSchema.parse(json);

    const days = payload.days ?? 120;
    const dryRun = payload.dryRun ?? false;
    syncRunId = await startSyncRunLog({
      runType: "full",
      requestId,
      marketplaceId: payload.marketplaceId,
      days,
      dryRun,
    });

    logStructured("full_sync_started", {
      requestId,
      days,
      marketplaceId: payload.marketplaceId,
      dryRun,
      limits: {
        maxPages: payload.maxPages,
        maxOrders: payload.maxOrders,
        maxOrdersWithItems: payload.maxOrdersWithItems,
        maxEventsPages: payload.maxEventsPages,
      },
    });

    const orders = await syncOrdersFromSpApi({
      days,
      marketplaceId: payload.marketplaceId,
      maxPages: payload.maxPages,
      maxOrders: payload.maxOrders,
      maxOrdersWithItems: payload.maxOrdersWithItems,
      dryRun,
    });

    const finances = await syncFinancesFromSpApi({
      days,
      marketplaceId: payload.marketplaceId ?? orders.marketplaceId,
      maxEventsPages: payload.maxEventsPages,
      dryRun,
    });

    const summary = await recomputeDailySummary({
      days,
      marketplaceId: payload.marketplaceId ?? orders.marketplaceId,
      dryRun,
    });

    const warnings: string[] = [];
    if (orders.diagnostics.pageLimitHit) {
      warnings.push("Order sync hit maxPages before exhausting upstream pages.");
    }
    if (orders.diagnostics.ordersSkippedForItems > 0) {
      warnings.push(
        `Skipped item fetch for ${orders.diagnostics.ordersSkippedForItems} orders due to maxOrdersWithItems.`,
      );
    }
    if (finances.diagnostics.eventPageLimitHit) {
      warnings.push("Finances sync hit maxEventsPages before exhausting upstream pages.");
    }
    if (summary.missingCogsItems > 0) {
      warnings.push(`${summary.missingCogsItems} units are missing COGS.`);
    }

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: true,
        warnings,
        marketplaceId: summary.marketplaceId,
      });
    }

    logStructured("full_sync_completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      warningsCount: warnings.length,
      dryRun,
      ordersDiagnostics: orders.diagnostics,
      financesDiagnostics: finances.diagnostics,
      summary: {
        summariesWritten: summary.summariesWritten,
        missingCogsItems: summary.missingCogsItems,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        result: {
          orders,
          finances,
          summary,
        },
        warnings,
        limitsApplied: {
          maxPages: orders.diagnostics.maxPages,
          maxOrders: orders.diagnostics.maxOrders,
          maxOrdersWithItems: orders.diagnostics.maxOrdersWithItems,
          maxEventsPages: finances.diagnostics.maxPages,
          dryRun,
        },
        truncationFlags: {
          orderPageLimitHit: orders.diagnostics.pageLimitHit,
          ordersSkippedForItems: orders.diagnostics.ordersSkippedForItems > 0,
          eventPageLimitHit: finances.diagnostics.eventPageLimitHit,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run sync job";

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: false,
        errorMessage: message,
      });
    }

    logStructured("full_sync_failed", {
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
