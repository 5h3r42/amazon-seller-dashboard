# Amazon Seller Dashboard

Next.js fullstack dashboard for Amazon sellers with SP-API syncing, catalog lookup, profitability views, expenses tracking, and CSV reporting.

## Features

- Catalog APIs:
  - `GET /api/catalog/lookup?ean={EAN}`
  - `GET /api/catalog/enriched?ean={EAN}`
- Sync pipeline endpoints:
  - `POST /api/sync/orders`
  - `POST /api/sync/finances`
  - `POST /api/sync/daily-summary`
  - `POST /api/sync/run`
  - `GET /api/sync/status`
- Productivity APIs:
  - `GET/POST /api/products/cogs`
  - `GET/POST /api/expenses`
  - `GET /api/reports/export?type=...&from=YYYY-MM-DD&to=YYYY-MM-DD`
- Dashboard order-items support:
  - pagination
  - grouping (`none`, `product`, `order`)
- Refund attribution via line-item allocations (`RefundAllocation`)
- Scan workspace with single and bulk barcode workflows
- Structured JSON error responses

## Requirements

- Node.js `>=20`
- `pnpm`
- Amazon SP-API credentials and authorization

## Environment Setup

Copy `.env.example` to `.env.local` and populate values:

```bash
cp .env.example .env.local
```

Important variables:

- `DATABASE_URL`
- `SP_API_REGION`, `SP_API_MARKETPLACE_ID`, `SP_API_SELLER_ID`
- `SP_API_CLIENT_ID`, `SP_API_CLIENT_SECRET`, `SP_API_REFRESH_TOKEN`
- `APP_ENCRYPTION_KEY` (required outside development/test)
- `INTERNAL_API_TOKEN` and `NEXT_PUBLIC_INTERNAL_API_TOKEN` (must match)

`/api/sync/*` and `/api/settings/*` are protected by internal token middleware.

## Run

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Scripts

```bash
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm start
```

## Sync Contract

`POST /api/sync/run` accepts optional:

- `days`
- `marketplaceId`
- `maxPages`
- `maxOrders`
- `maxOrdersWithItems`
- `maxEventsPages`
- `dryRun`

Sync responses include:

- `warnings[]`
- `limitsApplied`
- `truncationFlags`

## Notes

- Catalog lookup cache is process-local memory.
- The current setup is optimized for single-tenant/internal usage.
