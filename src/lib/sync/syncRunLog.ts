import { prisma } from "@/lib/db";

export type SyncRunType = "full" | "orders" | "finances" | "daily-summary";

interface StartSyncRunInput {
  runType: SyncRunType;
  requestId: string;
  marketplaceId?: string;
  days?: number;
  dryRun?: boolean;
}

interface FinishSyncRunInput {
  syncRunId: string;
  success: boolean;
  warnings?: string[];
  errorMessage?: string;
  marketplaceId?: string;
}

export async function startSyncRunLog(input: StartSyncRunInput): Promise<string> {
  const syncRun = await prisma.syncRun.create({
    data: {
      runType: input.runType,
      status: "running",
      requestId: input.requestId,
      marketplaceId: input.marketplaceId,
      days: input.days,
      dryRun: input.dryRun ?? false,
      startedAt: new Date(),
    },
    select: {
      id: true,
    },
  });

  return syncRun.id;
}

export async function finishSyncRunLog(input: FinishSyncRunInput): Promise<void> {
  const finishedAt = new Date();

  const existing = await prisma.syncRun.findUnique({
    where: {
      id: input.syncRunId,
    },
    select: {
      startedAt: true,
    },
  });

  const durationMs = existing
    ? Math.max(finishedAt.getTime() - existing.startedAt.getTime(), 0)
    : undefined;

  await prisma.syncRun.update({
    where: {
      id: input.syncRunId,
    },
    data: {
      status: input.success ? "success" : "failed",
      finishedAt,
      durationMs,
      warningsJson:
        input.warnings && input.warnings.length > 0
          ? JSON.stringify(input.warnings)
          : null,
      errorMessage: input.errorMessage ?? null,
      ...(input.marketplaceId ? { marketplaceId: input.marketplaceId } : {}),
    },
  });
}
