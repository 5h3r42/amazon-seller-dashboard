"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";

import type {
  EnrichedCatalogData,
  EnrichedLookupResponse,
  LookupResultItem,
} from "@/lib/catalog/types";

import styles from "./page.module.css";

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

interface BulkLookupEntry {
  ean: string;
  success: boolean;
  response?: EnrichedLookupResponse;
  errorMessage?: string;
}

interface BulkSuccessCard {
  status: "success";
  ean: string;
  item: LookupResultItem;
  enrichment?: EnrichedCatalogData;
  marketplaceId?: string;
}

interface BulkErrorCard {
  status: "error";
  ean: string;
  message: string;
}

type BulkCard = BulkSuccessCard | BulkErrorCard;

const AMAZON_HOST_BY_MARKETPLACE_ID: Record<string, string> = {
  ATVPDKIKX0DER: "www.amazon.com",
  A1F83G8C2ARO7P: "www.amazon.co.uk",
  A1PA6795UKMFR9: "www.amazon.de",
  A13V1IB3VIYZZH: "www.amazon.fr",
  APJ6JRA9NG5V4: "www.amazon.it",
  A1RKKUPIHCS9HS: "www.amazon.es",
};

function normalizeCode(rawValue: string): string {
  return rawValue.trim().replace(/[\s-]+/g, "");
}

function parseBulkCodes(input: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of input.split(/[\n,;\t ]+/)) {
    const normalized = normalizeCode(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || !Number.isFinite(amount)) {
    return "Unavailable";
  }

  if (!currency) {
    return amount.toFixed(2);
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatFees(enrichment: EnrichedCatalogData | undefined): string {
  if (!enrichment?.fees) {
    return "Unavailable";
  }

  if (enrichment.fees.status === "estimated") {
    return formatCurrency(enrichment.fees.totalFees ?? null, enrichment.fees.currency ?? null);
  }

  return enrichment.fees.message ?? "Unavailable";
}

function formatStock(enrichment: EnrichedCatalogData | undefined): string {
  if (!enrichment?.stock) {
    return "Unavailable";
  }

  if (enrichment.stock.status === "available") {
    return `FBM ${enrichment.stock.fbmQuantity ?? 0} · FBA ${
      enrichment.stock.fbaFulfillableQuantity ?? enrichment.stock.fbaTotalQuantity ?? 0
    }`;
  }

  return enrichment.stock.message ?? "Unavailable";
}

function getAmazonProductUrl(asin: string, marketplaceId?: string): string {
  const host =
    (marketplaceId && AMAZON_HOST_BY_MARKETPLACE_ID[marketplaceId]) || "www.amazon.com";

  return `https://${host}/dp/${encodeURIComponent(asin)}`;
}

export default function HomePage() {
  const [ean, setEan] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<EnrichedLookupResponse | null>(null);
  const [bulkCards, setBulkCards] = useState<BulkCard[]>([]);

  const runLookup = useCallback(
    async (
      rawCode: string,
      options?: { silent?: boolean; persistResponse?: boolean },
    ): Promise<BulkLookupEntry> => {
      const normalizedCode = normalizeCode(rawCode);
      if (!normalizedCode) {
        return {
          ean: rawCode,
          success: false,
          errorMessage: "Empty barcode value",
        };
      }

      const { silent = false, persistResponse = true } = options ?? {};

      if (!silent) {
        setIsLoading(true);
      }
      if (persistResponse) {
        setErrorMessage(null);
      }

      try {
        const requestUrl = `/api/catalog/enriched?ean=${encodeURIComponent(normalizedCode)}`;
        const apiResponse = await fetch(requestUrl, { cache: "no-store" });
        const payload = (await apiResponse.json()) as EnrichedLookupResponse | ErrorResponse;

        if (!apiResponse.ok) {
          const upstreamError = payload as ErrorResponse;
          const message =
            upstreamError.error?.message ?? "Lookup failed. Please try again.";

          if (persistResponse) {
            setErrorMessage(message);
          }

          return {
            ean: normalizedCode,
            success: false,
            errorMessage: message,
          };
        }

        const success = payload as EnrichedLookupResponse;
        if (persistResponse) {
          setResponse(success);
          setEan(success.input.ean);
        }

        return {
          ean: success.input.ean,
          success: true,
          response: success,
        };
      } catch {
        const message = "Request failed. Check your connection and try again.";
        if (persistResponse) {
          setErrorMessage(message);
        }
        return {
          ean: normalizedCode,
          success: false,
          errorMessage: message,
        };
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBulkCards([]);
      await runLookup(ean, { silent: false, persistResponse: true });
    },
    [ean, runLookup],
  );

  const onRunBulk = useCallback(async () => {
    const codes = parseBulkCodes(bulkInput);
    if (codes.length === 0) {
      return;
    }

    setIsBulkLoading(true);
    setErrorMessage(null);
    setResponse(null);
    setBulkCards([]);

    try {
      const collected: BulkLookupEntry[] = [];

      for (const code of codes) {
        // Keep request volume low for SP-API rate limits.
        const result = await runLookup(code, { silent: true, persistResponse: false });
        collected.push(result);
      }

      const cards: BulkCard[] = collected.map((entry) => {
        if (!entry.success || !entry.response) {
          return {
            status: "error",
            ean: entry.ean,
            message: entry.errorMessage ?? "Lookup failed for this barcode",
          };
        }

        const topItem = entry.response.results[0];

        if (!topItem) {
          return {
            status: "error",
            ean: entry.ean,
            message: "No catalog result found for this barcode",
          };
        }

        const topEnrichment =
          entry.response.enrichment?.asin === topItem.asin
            ? entry.response.enrichment
            : undefined;

        return {
          status: "success",
          ean: entry.ean,
          item: topItem,
          enrichment: topEnrichment,
          marketplaceId: entry.response.debug?.marketplaceId,
        };
      });

      setBulkCards(cards);

      const failedCount = cards.filter((card) => card.status === "error").length;
      if (failedCount > 0) {
        setErrorMessage(`${failedCount} of ${cards.length} lookups failed.`);
      }
    } finally {
      setIsBulkLoading(false);
    }
  }, [bulkInput, runLookup]);

  const bulkCodesCount = useMemo(() => parseBulkCodes(bulkInput).length, [bulkInput]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Amazon Catalog Lookup</h1>
          <p className={styles.subtitle}>
            Enter an EAN, UPC, or GTIN to query Catalog Items via SP-API.
          </p>
        </header>

        <section className={styles.searchPanel}>
          <form className={styles.form} onSubmit={onSubmit}>
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="EAN / UPC / GTIN"
              value={ean}
              onChange={(event) => setEan(event.target.value)}
              disabled={isLoading || isBulkLoading}
            />
            <button
              className={styles.button}
              type="submit"
              disabled={isLoading || isBulkLoading || normalizeCode(ean).length === 0}
            >
              {isLoading ? "Searching..." : "Search"}
            </button>
          </form>

          {errorMessage ? (
            <p className={styles.error}>{errorMessage}</p>
          ) : (
            <p className={styles.info}>
              {response
                ? `${response.results.length} result${response.results.length === 1 ? "" : "s"}`
                : "Enter a code to start"}
            </p>
          )}

          <section className={styles.bulkPanel}>
            <h2 className={styles.bulkTitle}>Bulk lookup (one barcode per line)</h2>
            <textarea
              className={styles.bulkInput}
              rows={6}
              value={bulkInput}
              onChange={(event) => setBulkInput(event.target.value)}
              placeholder={"802297111261\n802297175317\n802297141565"}
              disabled={isLoading || isBulkLoading}
            />
            <div className={styles.bulkActions}>
              <p className={styles.info}>{bulkCodesCount} unique code(s) queued</p>
              <button
                className={styles.historyButton}
                type="button"
                onClick={onRunBulk}
                disabled={isLoading || isBulkLoading || bulkCodesCount === 0}
              >
                {isBulkLoading ? "Running..." : "Run bulk lookup"}
              </button>
            </div>
          </section>

          {bulkCards.length > 0 ? (
            <section className={styles.history}>
              <h2 className={styles.historyTitle}>Bulk results</h2>
              <ul className={styles.results}>
                {bulkCards.map((card, index) =>
                  card.status === "error" ? (
                    <li className={`${styles.card} ${styles.bulkCardError}`} key={`bulk-error-${index}`}>
                      <div className={styles.imagePlaceholder}>!</div>
                      <div className={styles.content}>
                        <p className={styles.rank}>Barcode Failed</p>
                        <h3>{card.ean}</h3>
                        <p className={styles.meta}>{card.message}</p>
                      </div>
                    </li>
                  ) : (
                    <li
                      className={`${styles.card} ${styles.bulkCard}`}
                      key={`bulk-${card.ean}-${card.item.asin}`}
                    >
                      {card.item.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className={styles.image}
                          src={card.item.images[0]}
                          alt={card.item.title ?? card.item.asin}
                        />
                      ) : (
                        <div className={styles.imagePlaceholder}>No image</div>
                      )}
                      <div className={styles.content}>
                        <p className={styles.rank}>Bulk Match #{index + 1}</p>
                        <h3>
                          <a
                            className={styles.productLink}
                            href={getAmazonProductUrl(card.item.asin, card.marketplaceId)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {card.item.title ?? "Untitled Product"}
                          </a>
                        </h3>
                        <p className={styles.meta}>EAN: {card.ean}</p>
                        <p className={styles.meta}>ASIN: {card.item.asin}</p>
                        <p className={styles.meta}>
                          Product Type: {card.item.productType ?? "Unknown"}
                        </p>
                        {card.item.brand ? (
                          <p className={styles.meta}>Brand: {card.item.brand}</p>
                        ) : null}
                        <p className={styles.meta}>
                          Price:{" "}
                          {formatCurrency(
                            card.enrichment?.pricing?.landedPrice ?? null,
                            card.enrichment?.pricing?.currency ?? null,
                          )}
                        </p>
                        <p className={styles.meta}>Fees: {formatFees(card.enrichment)}</p>
                        <p className={styles.meta}>Stock: {formatStock(card.enrichment)}</p>
                        {card.enrichment?.warnings.length ? (
                          <p className={styles.warn}>{card.enrichment.warnings.join(" | ")}</p>
                        ) : null}
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ) : null}
        </section>

        {response?.enrichment ? (
          <section className={styles.enrichment}>
            <h2 className={styles.enrichmentTitle}>Pricing / Fees / Stock</h2>
            <p className={styles.meta}>
              ASIN: <strong>{response.enrichment.asin}</strong>
            </p>
            <p className={styles.meta}>
              Price:{" "}
              {response.enrichment.pricing
                ? formatCurrency(
                    response.enrichment.pricing.landedPrice,
                    response.enrichment.pricing.currency,
                  )
                : "Unavailable"}
            </p>
            <p className={styles.meta}>
              Fees:{" "}
              {response.enrichment.fees?.status === "estimated"
                ? formatCurrency(
                    response.enrichment.fees.totalFees ?? null,
                    response.enrichment.fees.currency ?? null,
                  )
                : response.enrichment.fees?.message ?? "Unavailable"}
            </p>
            <p className={styles.meta}>
              Stock:{" "}
              {response.enrichment.stock?.status === "available"
                ? `FBM ${response.enrichment.stock.fbmQuantity ?? 0} · FBA ${
                    response.enrichment.stock.fbaFulfillableQuantity ??
                    response.enrichment.stock.fbaTotalQuantity ??
                    0
                  }`
                : response.enrichment.stock?.message ?? "Unavailable"}
            </p>
            {response.enrichment.warnings.length > 0 ? (
              <p className={styles.warn}>{response.enrichment.warnings.join(" | ")}</p>
            ) : null}
          </section>
        ) : null}

        {response ? (
          <ul className={styles.results}>
            {response.results.map((item, index) => (
              <li className={styles.card} key={item.asin}>
                {item.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.image} src={item.images[0]} alt={item.title ?? item.asin} />
                ) : null}
                <div className={styles.content}>
                  <p className={styles.rank}>Rank #{index + 1}</p>
                  <h3>
                    <a
                      className={styles.productLink}
                      href={getAmazonProductUrl(item.asin, response.debug?.marketplaceId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.title ?? "Untitled Product"}
                    </a>
                  </h3>
                  <p className={styles.meta}>ASIN: {item.asin}</p>
                  <p className={styles.meta}>
                    Product Type: {item.productType ?? "Unknown"}
                  </p>
                  {item.brand ? <p className={styles.meta}>Brand: {item.brand}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {response?.debug ? (
          <pre className={styles.debug}>{JSON.stringify(response.debug, null, 2)}</pre>
        ) : null}
      </main>
    </div>
  );
}
