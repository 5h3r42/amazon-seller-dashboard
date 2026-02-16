# Amazon Seller Dashboard (v1 Catalog Lookup)

Minimal Next.js fullstack app to look up Amazon catalog items by EAN/UPC/GTIN using the Amazon Selling Partner API Catalog Items API.

## Features

- `GET /api/catalog/lookup?ean={EAN}` endpoint
- `GET /api/catalog/enriched?ean={EAN}` endpoint for pricing + fees + stock context
- GTIN validation (digits, length 8/12/13/14, GS1 check-digit)
- SP-API Catalog Items `searchCatalogItems` integration
- Identifier-aware ranking and cleaning (exact identifier matches prioritized)
- In-memory cache with TTL for repeated lookups
- Normalized response fields: `asin`, `title`, `productType`, optional `brand`, optional `images`
- Minimal UI at `/` with manual barcode input and recent scan history
- Structured JSON error responses
- `debug` response object only when `NODE_ENV !== "production"`

## Requirements

- Node.js `>=20`
- `pnpm`
- Amazon SP-API app access and credentials:
  - LWA client ID/secret
  - LWA refresh token
  - Catalog Items API authorization for your seller account

## Environment Setup

Copy `.env.example` to `.env.local` and populate values:

```bash
cp .env.example .env.local
```

`.env.example`

```bash
SP_API_REGION=na
SP_API_MARKETPLACE_ID=ATVPDKIKX0DER
SP_API_SELLER_ID=
LWA_CLIENT_ID=
LWA_CLIENT_SECRET=
LWA_REFRESH_TOKEN=
SP_API_USER_AGENT=AmazonSellerDashboard/0.1 (Language=TypeScript; Platform=Node.js)
```

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

## API Contract

### Request

`GET /api/catalog/lookup?ean={EAN}`

### Enriched Request

`GET /api/catalog/enriched?ean={EAN}&sku={OPTIONAL_SELLER_SKU}`

### Success Response (`200`)

```json
{
  "input": { "ean": "4006381333931" },
  "results": [
    {
      "asin": "B0XXXXXXX",
      "title": "Product Title",
      "productType": "PRODUCT_TYPE",
      "brand": "Brand",
      "images": ["https://..."]
    }
  ],
  "debug": {
    "marketplaceId": "ATVPDKIKX0DER",
    "region": "na",
    "identifiersType": "EAN",
    "cacheHit": false,
    "rawResults": 12,
    "rankedResults": 10,
    "exactIdentifierMatches": 2,
    "upstreamRequestId": "optional"
  }
}
```

`debug` is omitted in production.

### Enriched Success Additions (`/api/catalog/enriched`)

`enrichment` is included when at least one ASIN is found:

```json
{
  "enrichment": {
    "asin": "B0XXXXXXX",
    "pricing": {
      "currency": "GBP",
      "listingPrice": 9.99,
      "shippingPrice": 0,
      "landedPrice": 9.99,
      "totalOfferCount": 3,
      "buyBoxWinner": true
    },
    "fees": {
      "status": "estimated",
      "currency": "GBP",
      "totalFees": 2.1
    },
    "stock": {
      "status": "available",
      "source": "seller_sku",
      "sellerSku": "SKU-123",
      "fbmQuantity": 4,
      "fbaFulfillableQuantity": 10,
      "fbaTotalQuantity": 12
    },
    "warnings": []
  }
}
```

Stock notes:
- If `sku` is passed, stock lookup uses it directly.
- If `sku` is not passed, automatic SKU lookup requires `SP_API_SELLER_ID`.
- Without SKU resolution, stock is returned as unavailable with guidance.

### Error Response (`4xx` / `5xx`)

```json
{
  "error": {
    "code": "INVALID_EAN",
    "message": "Invalid EAN/UPC/GTIN check digit"
  }
}
```

Error codes:

- `INVALID_EAN` (`400`)
- `AMAZON_RATE_LIMITED` (`429`)
- `AMAZON_UPSTREAM_ERROR` (`502`)
- `CONFIG_ERROR` (`500`)
- `INTERNAL_ERROR` (`500`)

## Test Coverage Scope

- GTIN validation and identifier type mapping
- Catalog item normalization behavior on sparse and full payloads
- API route behavior for:
  - missing/invalid input
  - success response shape and max 10 results
  - exact identifier prioritization and cache hits
  - mapped upstream and config errors
  - debug inclusion/exclusion by environment

## v1 Limits

- No camera scanning (manual input only)
- Single env-configured marketplace/region
- No pricing/fees/listing workflows
- Cache is process-local memory (not shared or persistent across restarts)
