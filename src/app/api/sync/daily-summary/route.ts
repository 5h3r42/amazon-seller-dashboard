import { NextResponse } from "next/server";
import { z } from "zod";

import { ConfigError } from "@/lib/env";
import { recomputeDailySummary } from "@/lib/metrics/dailySummary";

export const runtime = "nodejs";

const syncSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  marketplaceId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const payload = syncSchema.parse(json);

    const result = await recomputeDailySummary({
      days: payload.days,
      marketplaceId: payload.marketplaceId,
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
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

    const message =
      error instanceof Error ? error.message : "Failed to recompute daily summary";

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
