-- CreateTable
CREATE TABLE "RefundAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "financialEventId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RefundAllocation_financialEventId_fkey" FOREIGN KEY ("financialEventId") REFERENCES "FinancialEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RefundAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "category" TEXT NOT NULL,
    "notes" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "days" INTEGER,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "warningsJson" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_event_item_unique" ON "RefundAllocation"("financialEventId", "orderItemId");

-- CreateIndex
CREATE INDEX "RefundAllocation_financialEventId_idx" ON "RefundAllocation"("financialEventId");

-- CreateIndex
CREATE INDEX "RefundAllocation_orderItemId_idx" ON "RefundAllocation"("orderItemId");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_category_date_idx" ON "Expense"("category", "date");

-- CreateIndex
CREATE INDEX "SyncRun_runType_startedAt_idx" ON "SyncRun"("runType", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_status_startedAt_idx" ON "SyncRun"("status", "startedAt");
