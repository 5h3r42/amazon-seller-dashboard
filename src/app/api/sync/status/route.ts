import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const recentRuns = await prisma.syncRun.findMany({
    orderBy: {
      startedAt: "desc",
    },
    take: 20,
    select: {
      id: true,
      runType: true,
      status: true,
      requestId: true,
      marketplaceId: true,
      days: true,
      dryRun: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      warningsJson: true,
      errorMessage: true,
    },
  });

  const lastSuccess = recentRuns.find((run) => run.status === "success") ?? null;
  const lastFailure = recentRuns.find((run) => run.status === "failed") ?? null;

  return NextResponse.json(
    {
      ok: true,
      status: {
        lastSuccessAt: lastSuccess?.finishedAt ?? lastSuccess?.startedAt ?? null,
        lastFailureAt: lastFailure?.finishedAt ?? lastFailure?.startedAt ?? null,
      },
      runs: recentRuns.map((run) => ({
        ...run,
        warnings: (() => {
          if (!run.warningsJson) {
            return [] as string[];
          }

          try {
            return JSON.parse(run.warningsJson) as string[];
          } catch {
            return [] as string[];
          }
        })(),
      })),
    },
    { status: 200 },
  );
}
