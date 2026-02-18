import { NextResponse } from "next/server";

import {
  type DashboardGroupBy,
  getDashboardOrderItems,
  type DashboardRangeInput,
} from "@/lib/dashboard/queries";

export const runtime = "nodejs";

function toRangePreset(raw: string | null): DashboardRangeInput["preset"] {
  if (raw === "today" || raw === "yesterday" || raw === "mtd" || raw === "custom") {
    return raw;
  }

  return "today";
}

function toGroupBy(raw: string | null): DashboardGroupBy {
  if (raw === "product" || raw === "order") {
    return raw;
  }

  return "none";
}

function toPositiveInt(raw: string | null, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const requestUrl = new URL(request.url);

    const rangePreset = toRangePreset(requestUrl.searchParams.get("range"));
    const from = requestUrl.searchParams.get("from") ?? undefined;
    const to = requestUrl.searchParams.get("to") ?? undefined;
    const search = requestUrl.searchParams.get("search") ?? undefined;
    const marketplaceId = requestUrl.searchParams.get("marketplaceId") ?? undefined;
    const groupBy = toGroupBy(requestUrl.searchParams.get("groupBy"));
    const page = toPositiveInt(requestUrl.searchParams.get("page"), 1);
    const pageSize = toPositiveInt(requestUrl.searchParams.get("pageSize"), 50);

    const payload = await getDashboardOrderItems({
      range: {
        preset: rangePreset,
        from,
        to,
      },
      search,
      marketplaceId,
      groupBy,
      page,
      pageSize,
    });

    return NextResponse.json(
      {
        ok: true,
        ...payload,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load dashboard order items";

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
