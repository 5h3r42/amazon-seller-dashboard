-- CreateTable
CREATE TABLE "AmazonConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "lwaClientId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amazonOrderId" TEXT NOT NULL,
    "purchaseDate" DATETIME NOT NULL,
    "orderStatus" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "buyerCountry" TEXT,
    "totalAmount" DECIMAL,
    "currency" TEXT,
    "connectionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AmazonConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amazonOrderId" TEXT NOT NULL,
    "asin" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "quantityOrdered" INTEGER NOT NULL DEFAULT 0,
    "itemPrice" DECIMAL,
    "itemTax" DECIMAL,
    "promotionDiscount" DECIMAL,
    "isRefunded" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_amazonOrderId_fkey" FOREIGN KEY ("amazonOrderId") REFERENCES "Order" ("amazonOrderId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "postedDate" DATETIME NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "amazonOrderId" TEXT,
    "asin" TEXT,
    "sku" TEXT,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialEvent_amazonOrderId_fkey" FOREIGN KEY ("amazonOrderId") REFERENCES "Order" ("amazonOrderId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asin" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "COGS" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT,
    "asin" TEXT,
    "unitCost" DECIMAL NOT NULL,
    "includesVat" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DailySummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "sales" DECIMAL NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "refunds" DECIMAL NOT NULL DEFAULT 0,
    "amazonFees" DECIMAL NOT NULL DEFAULT 0,
    "otherFees" DECIMAL NOT NULL DEFAULT 0,
    "netPayout" DECIMAL NOT NULL DEFAULT 0,
    "cogs" DECIMAL NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL NOT NULL DEFAULT 0,
    "netProfit" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AmazonConnection_marketplaceId_idx" ON "AmazonConnection"("marketplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_marketplace_unique" ON "AmazonConnection"("sellerId", "marketplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_amazonOrderId_key" ON "Order"("amazonOrderId");

-- CreateIndex
CREATE INDEX "Order_purchaseDate_idx" ON "Order"("purchaseDate");

-- CreateIndex
CREATE INDEX "Order_marketplaceId_purchaseDate_idx" ON "Order"("marketplaceId", "purchaseDate");

-- CreateIndex
CREATE INDEX "OrderItem_amazonOrderId_idx" ON "OrderItem"("amazonOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_asin_idx" ON "OrderItem"("asin");

-- CreateIndex
CREATE INDEX "OrderItem_sku_idx" ON "OrderItem"("sku");

-- CreateIndex
CREATE INDEX "OrderItem_title_idx" ON "OrderItem"("title");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_eventKey_key" ON "FinancialEvent"("eventKey");

-- CreateIndex
CREATE INDEX "FinancialEvent_postedDate_idx" ON "FinancialEvent"("postedDate");

-- CreateIndex
CREATE INDEX "FinancialEvent_marketplaceId_postedDate_idx" ON "FinancialEvent"("marketplaceId", "postedDate");

-- CreateIndex
CREATE INDEX "FinancialEvent_amazonOrderId_idx" ON "FinancialEvent"("amazonOrderId");

-- CreateIndex
CREATE INDEX "FinancialEvent_asin_idx" ON "FinancialEvent"("asin");

-- CreateIndex
CREATE INDEX "FinancialEvent_sku_idx" ON "FinancialEvent"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_asin_key" ON "Product"("asin");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "COGS_sku_key" ON "COGS"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "COGS_asin_key" ON "COGS"("asin");

-- CreateIndex
CREATE INDEX "DailySummary_marketplaceId_date_idx" ON "DailySummary"("marketplaceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "date_marketplace_summary_unique" ON "DailySummary"("date", "marketplaceId");
