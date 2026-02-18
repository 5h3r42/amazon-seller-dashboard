import { NextResponse } from "next/server";
import { z } from "zod";

import { ConfigError } from "@/lib/env";
import { getRequestId, logStructured } from "@/lib/http/requestMeta";
import { recomputeDailySummary } from "@/lib/metrics/dailySummary";
import { finishSyncRunLog, startSyncRunLog } from "@/lib/sync/syncRunLog";

export const runtime = "nodejs";

const syncSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  marketplaceId: z.string().trim().min(1).optional(),
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
      runType: "daily-summary",
      requestId,
      marketplaceId: payload.marketplaceId,
      days: payload.days,
      dryRun: payload.dryRun,
    });

    logStructured("daily_summary_recompute_started", {
      requestId,
      days: payload.days,
      marketplaceId: payload.marketplaceId,
      dryRun: payload.dryRun ?? false,
    });

    const result = await recomputeDailySummary({
      days: payload.days,
      marketplaceId: payload.marketplaceId,
      dryRun: payload.dryRun,
    });

    const warnings: string[] = [];
    if (result.missingCogsItems > 0) {
      warnings.push(`${result.missingCogsItems} units are missing COGS.`);
    }

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: true,
        warnings,
        marketplaceId: result.marketplaceId,
      });
    }

    logStructured("daily_summary_recompute_completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      warningsCount: warnings.length,
      dryRun: result.dryRun,
      summariesWritten: result.summariesWritten,
      missingCogsItems: result.missingCogsItems,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId,
        result,
        warnings,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to recompute daily summary";

    if (syncRunId) {
      await finishSyncRunLog({
        syncRunId,
        success: false,
        errorMessage: message,
      });
    }

    logStructured("daily_summary_recompute_failed", {
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
