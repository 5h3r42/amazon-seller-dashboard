import { NextResponse } from "next/server";

import {
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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const requestUrl = new URL(request.url);

    const rangePreset = toRangePreset(requestUrl.searchParams.get("range"));
    const from = requestUrl.searchParams.get("from") ?? undefined;
    const to = requestUrl.searchParams.get("to") ?? undefined;
    const search = requestUrl.searchParams.get("search") ?? undefined;
    const marketplaceId = requestUrl.searchParams.get("marketplaceId") ?? undefined;

    const payload = await getDashboardOrderItems({
      range: {
        preset: rangePreset,
        from,
        to,
      },
      search,
      marketplaceId,
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
