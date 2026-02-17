"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type {
  EnrichedCatalogData,
  EnrichedLookupResponse,
  LookupResultItem,
} from "@/lib/catalog/types";
import { InvalidEanError, parseGtin } from "@/lib/gtin";
import { cn } from "@/lib/utils";

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
  lookedAt: string;
}

interface BulkSuccessCard {
  status: "success";
  ean: string;
  item: LookupResultItem;
  enrichment?: EnrichedCatalogData;
  marketplaceId?: string;
  lookedAt: string;
}

interface BulkErrorCard {
  status: "error";
  ean: string;
  message: string;
  lookedAt: string;
}

type BulkCard = BulkSuccessCard | BulkErrorCard;

type SelectionSource = "single" | "bulk";

type ScanSubsection = "single" | "bulk" | "results";

type ScanMode = "single" | "bulk";

interface SelectionEntry {
  id: string;
  source: SelectionSource;
  ean: string;
  item: LookupResultItem;
  enrichment?: EnrichedCatalogData;
  marketplaceId?: string;
  rank: number;
  createdAt: string;
}

const SCAN_WORKSPACE_STORAGE_KEY = "scan-workspace-state-v1";

interface PersistedScanWorkspaceState {
  version: 1;
  scanMode: ScanMode;
  selectedId: string | null;
  ean: string;
  bulkInput: string;
  errorMessage: string | null;
  response: EnrichedLookupResponse | null;
  bulkCards: BulkCard[];
  singleLookupAt: string | null;
}

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

function getBulkValidationMeta(input: string): {
  lineCount: number;
  validUniqueCount: number;
  invalidEntryCount: number;
} {
  const tokens = input
    .split(/[\n,;\t ]+/)
    .map((value) => normalizeCode(value))
    .filter((value) => value.length > 0);

  let invalidEntryCount = 0;
  const validUnique = new Set<string>();

  for (const token of tokens) {
    try {
      parseGtin(token);
      validUnique.add(token);
    } catch {
      invalidEntryCount += 1;
    }
  }

  const lineCount = input.split(/\n/).filter((line) => line.trim().length > 0).length;

  return {
    lineCount,
    validUniqueCount: validUnique.size,
    invalidEntryCount,
  };
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

function formatTime24(timestamp: string | null): string {
  if (!timestamp) {
    return "--:--:--";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSingleValidationMessage(input: string): string | null {
  if (input.trim().length === 0) {
    return null;
  }

  try {
    parseGtin(input);
    return null;
  } catch (error) {
    if (error instanceof InvalidEanError) {
      return error.message;
    }

    return "Invalid EAN/UPC/GTIN value.";
  }
}

function getConfidenceLabel(rank: number): "High" | "Medium" | "Low" {
  if (rank <= 1) {
    return "High";
  }

  if (rank <= 3) {
    return "Medium";
  }

  return "Low";
}

export default function HomePage() {
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>("single");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ean, setEan] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<EnrichedLookupResponse | null>(null);
  const [bulkCards, setBulkCards] = useState<BulkCard[]>([]);
  const [singleLookupAt, setSingleLookupAt] = useState<string | null>(null);
  const [queuedUpdatedAt, setQueuedUpdatedAt] = useState<string | null>(null);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [failedUpdatedAt, setFailedUpdatedAt] = useState<string | null>(null);

  const runLookup = useCallback(
    async (
      rawCode: string,
      options?: { silent?: boolean; persistResponse?: boolean },
    ): Promise<Omit<BulkLookupEntry, "lookedAt">> => {
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
          setSingleLookupAt(new Date().toISOString());
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

  const runSingleLookup = useCallback(async () => {
    setBulkCards([]);
    setSelectedId(null);
    await runLookup(ean, { silent: false, persistResponse: true });
  }, [ean, runLookup]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setScanMode("single");
      await runSingleLookup();
    },
    [runSingleLookup],
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
    setSelectedId(null);

    try {
      const collected: BulkLookupEntry[] = [];

      for (const code of codes) {
        // Keep request volume low for SP-API rate limits.
        const result = await runLookup(code, { silent: true, persistResponse: false });
        collected.push({ ...result, lookedAt: new Date().toISOString() });
      }

      const cards: BulkCard[] = collected.map((entry) => {
        if (!entry.success || !entry.response) {
          return {
            status: "error",
            ean: entry.ean,
            message: entry.errorMessage ?? "Lookup failed for this barcode",
            lookedAt: entry.lookedAt,
          };
        }

        const topItem = entry.response.results[0];

        if (!topItem) {
          return {
            status: "error",
            ean: entry.ean,
            message: "No catalog result found for this barcode",
            lookedAt: entry.lookedAt,
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
          lookedAt: entry.lookedAt,
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

  const onRetry = useCallback(async () => {
    if (scanMode === "bulk") {
      await onRunBulk();
      return;
    }

    await runSingleLookup();
  }, [onRunBulk, runSingleLookup, scanMode]);

  const setSection = useCallback((section: ScanSubsection) => {
    if (section === "single" || section === "bulk") {
      setScanMode(section);
    }
  }, []);

  const bulkCodesCount = useMemo(() => parseBulkCodes(bulkInput).length, [bulkInput]);

  const bulkValidationMeta = useMemo(() => getBulkValidationMeta(bulkInput), [bulkInput]);

  const failedBulkCount = useMemo(
    () => bulkCards.filter((card) => card.status === "error").length,
    [bulkCards],
  );

  const singleValidationMessage = useMemo(() => getSingleValidationMessage(ean), [ean]);

  const selectionEntries = useMemo<SelectionEntry[]>(() => {
    const entries: SelectionEntry[] = [];

    if (response) {
      for (const [index, item] of response.results.entries()) {
        const enrichment =
          response.enrichment?.asin === item.asin ? response.enrichment : undefined;

        entries.push({
          id: `single-${response.input.ean}-${item.asin}-${index}`,
          source: "single",
          ean: response.input.ean,
          item,
          enrichment,
          marketplaceId: response.debug?.marketplaceId,
          rank: index + 1,
          createdAt: singleLookupAt ?? new Date().toISOString(),
        });
      }
    }

    for (const [index, card] of bulkCards.entries()) {
      if (card.status !== "success") {
        continue;
      }

      entries.push({
        id: `bulk-${card.ean}-${card.item.asin}-${index}`,
        source: "bulk",
        ean: card.ean,
        item: card.item,
        enrichment: card.enrichment,
        marketplaceId: card.marketplaceId,
        rank: 1,
        createdAt: card.lookedAt,
      });
    }

    return entries;
  }, [bulkCards, response, singleLookupAt]);

  const selectedEntry = useMemo(() => {
    if (selectionEntries.length === 0) {
      return null;
    }

    return selectionEntries.find((entry) => entry.id === selectedId) ?? selectionEntries[0];
  }, [selectedId, selectionEntries]);

  const hasLoadingState = isLoading || isBulkLoading;

  const successMessage =
    !hasLoadingState && !errorMessage && selectionEntries.length > 0
      ? "Lookup completed."
      : null;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SCAN_WORKSPACE_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedScanWorkspaceState>;
      if (parsed.version !== 1) {
        return;
      }

      if (parsed.scanMode === "single" || parsed.scanMode === "bulk") {
        setScanMode(parsed.scanMode);
      }

      setSelectedId(typeof parsed.selectedId === "string" ? parsed.selectedId : null);
      setEan(typeof parsed.ean === "string" ? parsed.ean : "");
      setBulkInput(typeof parsed.bulkInput === "string" ? parsed.bulkInput : "");
      setErrorMessage(typeof parsed.errorMessage === "string" ? parsed.errorMessage : null);
      setResponse(parsed.response ?? null);
      setBulkCards(Array.isArray(parsed.bulkCards) ? parsed.bulkCards : []);
      setSingleLookupAt(typeof parsed.singleLookupAt === "string" ? parsed.singleLookupAt : null);
    } catch {
      // Ignore malformed persisted state and continue with defaults.
    } finally {
      setHasHydratedPersistedState(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydratedPersistedState) {
      return;
    }

    const persistedState: PersistedScanWorkspaceState = {
      version: 1,
      scanMode,
      selectedId,
      ean,
      bulkInput,
      errorMessage,
      response,
      bulkCards,
      singleLookupAt,
    };

    window.localStorage.setItem(SCAN_WORKSPACE_STORAGE_KEY, JSON.stringify(persistedState));
  }, [
    hasHydratedPersistedState,
    scanMode,
    selectedId,
    ean,
    bulkInput,
    errorMessage,
    response,
    bulkCards,
    singleLookupAt,
  ]);

  useEffect(() => {
    setQueuedUpdatedAt(new Date().toISOString());
  }, [bulkCodesCount]);

  useEffect(() => {
    setLoadedUpdatedAt(new Date().toISOString());
  }, [selectionEntries.length]);

  useEffect(() => {
    setFailedUpdatedAt(new Date().toISOString());
  }, [failedBulkCount]);

  const metricCards = useMemo(
    () => [
      {
        id: "queued",
        label: "Queued Codes",
        value: bulkCodesCount,
        icon: Clock3,
        iconClassName: "text-blue-300",
        iconContainerClassName: "bg-blue-500/10 border-blue-400/20",
        lastUpdated: queuedUpdatedAt,
      },
      {
        id: "loaded",
        label: "Loaded Results",
        value: selectionEntries.length,
        icon: CheckCircle2,
        iconClassName: "text-emerald-300",
        iconContainerClassName: "bg-emerald-500/10 border-emerald-400/20",
        lastUpdated: loadedUpdatedAt,
      },
      {
        id: "failed",
        label: "Failed Bulk",
        value: failedBulkCount,
        icon: TriangleAlert,
        iconClassName: "text-red-300",
        iconContainerClassName: "bg-red-500/10 border-red-400/20",
        lastUpdated: failedUpdatedAt,
      },
    ],
    [bulkCodesCount, failedBulkCount, loadedUpdatedAt, queuedUpdatedAt, selectionEntries.length, failedUpdatedAt],
  );

  return (
    <div className="min-h-full overflow-x-hidden bg-background text-foreground antialiased">
      <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
              <div className="space-y-4">
                <section className="space-y-1">
                  <h1 className="text-[28px] leading-8 font-semibold tracking-tight">Scan Workspace</h1>
                  <p className="text-base leading-6 text-muted-foreground">
                    Single scan, bulk scan, and results in one workspace.
                  </p>
                </section>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                  {metricCards.map((metric) => {
                    const Icon = metric.icon;

                    return (
                      <Card
                        key={metric.id}
                        className="group relative py-4 transition-colors duration-200 hover:bg-accent/20 md:col-span-4"
                      >
                        <CardHeader className="space-y-2 px-4 pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <CardDescription className="text-[14px] leading-5 font-medium">
                              {metric.label}
                            </CardDescription>
                            <div
                              className={cn(
                                "inline-flex size-8 items-center justify-center rounded-md border",
                                metric.iconContainerClassName,
                              )}
                            >
                              <Icon className={cn("size-4", metric.iconClassName)} />
                            </div>
                          </div>
                          {hasLoadingState ? (
                            <Skeleton className="h-10 w-20" />
                          ) : (
                            <CardTitle className="text-[36px] leading-10 font-semibold tracking-tight">
                              {metric.value}
                            </CardTitle>
                          )}
                        </CardHeader>
                        <CardContent className="px-4 pt-2">
                          {hasLoadingState ? (
                            <Skeleton className="h-4 w-32" />
                          ) : (
                            <p className="text-[13px] leading-[18px] text-muted-foreground">
                              Last update: {formatTime24(metric.lastUpdated)}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}

                  <Card className="md:col-span-8">
                    <CardHeader className="space-y-1">
                      <CardTitle className="text-[22px] leading-7 font-semibold tracking-tight">Scan</CardTitle>
                      <CardDescription className="text-[13px] leading-[18px] text-muted-foreground">
                        Switch between single and bulk lookup without leaving this workspace.
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-6">
                      <section className="space-y-4">
                        <div
                          className="inline-flex rounded-lg border bg-muted/50 p-1"
                          role="tablist"
                          aria-label="Scan mode"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={scanMode === "single"}
                            className={cn(
                              "inline-flex h-10 min-w-24 items-center justify-center rounded-md px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                              scanMode === "single"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setSection("single")}
                          >
                            Single
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={scanMode === "bulk"}
                            className={cn(
                              "inline-flex h-10 min-w-24 items-center justify-center rounded-md px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                              scanMode === "bulk"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={() => setSection("bulk")}
                          >
                            Bulk
                          </button>
                        </div>

                        {scanMode === "single" ? (
                          <section id="scan-single" className="space-y-3.5">
                            <div className="space-y-1">
                              <h3 className="text-base leading-6 font-semibold tracking-tight">
                                Single Barcode
                              </h3>
                              <p className="text-[13px] leading-[18px] text-muted-foreground">
                                Enter EAN / UPC / GTIN.
                              </p>
                            </div>

                            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={onSubmit}>
                              <Input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="EAN / UPC / GTIN"
                                value={ean}
                                onFocus={() => setSection("single")}
                                onChange={(event) => setEan(event.target.value)}
                                disabled={hasLoadingState}
                                aria-invalid={singleValidationMessage ? true : undefined}
                                className="h-10"
                              />
                              <Button
                                type="submit"
                                className="h-10 w-full px-4 sm:w-auto"
                                disabled={hasLoadingState || normalizeCode(ean).length === 0}
                              >
                                {isLoading ? "Searching..." : "Search"}
                              </Button>
                            </form>

                            {singleValidationMessage ? (
                              <p className="text-[13px] leading-[18px] text-destructive">
                                {singleValidationMessage}
                              </p>
                            ) : (
                              <p className="text-[13px] leading-[18px] text-muted-foreground">
                                Enter EAN, UPC, or GTIN to start lookup.
                              </p>
                            )}
                          </section>
                        ) : (
                          <section id="scan-bulk" className="space-y-3.5">
                            <div className="space-y-1">
                              <h3 className="text-base leading-6 font-semibold tracking-tight">
                                Bulk Barcodes
                              </h3>
                              <p className="text-[13px] leading-[18px] text-muted-foreground">
                                Paste one or more barcodes separated by new lines, commas, tabs, or spaces.
                              </p>
                            </div>

                            <Textarea
                              rows={8}
                              value={bulkInput}
                              onFocus={() => setSection("bulk")}
                              onChange={(event) => setBulkInput(event.target.value)}
                              placeholder={"802297111261\n802297175317\n802297141565"}
                              disabled={hasLoadingState}
                              className="min-h-44"
                            />

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                              <p className="text-[13px] leading-[18px] text-muted-foreground">
                                {bulkValidationMeta.lineCount} line(s) · {bulkValidationMeta.validUniqueCount} valid unique code(s) · {" "}
                                {bulkValidationMeta.invalidEntryCount} invalid entr
                                {bulkValidationMeta.invalidEntryCount === 1 ? "y" : "ies"}
                              </p>

                              <Button
                                type="button"
                                className="h-10 w-full px-4 sm:ml-auto sm:w-auto"
                                onClick={onRunBulk}
                                disabled={hasLoadingState || bulkCodesCount === 0}
                              >
                                {isBulkLoading ? "Running..." : "Run bulk lookup"}
                              </Button>
                            </div>
                          </section>
                        )}
                      </section>

                      <Separator />

                      <section id="scan-results" className="scroll-mt-20 space-y-3.5">
                        <h3 className="text-base leading-6 font-semibold tracking-tight">Results Preview</h3>

                        {hasLoadingState ? (
                          <div className="space-y-3">
                            <Skeleton className="h-28 w-full rounded-lg" />
                            <Skeleton className="h-28 w-full rounded-lg" />
                            <Skeleton className="h-28 w-full rounded-lg" />
                          </div>
                        ) : selectionEntries.length === 0 ? (
                          <div className="rounded-lg bg-muted/50 p-4">
                            <p className="text-base leading-6 font-medium">No results yet</p>
                            <p className="text-[13px] leading-[18px] text-muted-foreground">
                              Run a single or bulk lookup to populate results.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3" onMouseEnter={() => setSection("results")}>
                            {selectionEntries.map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                className={cn(
                                  "w-full rounded-lg border bg-card p-4 text-left transition-all outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring",
                                  selectedEntry?.id === entry.id &&
                                    "border-primary/60 bg-accent/35",
                                )}
                                onFocus={() => setSection("results")}
                                onClick={() => {
                                  setSection("results");
                                  setSelectedId(entry.id);
                                }}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-100">
                                      Loaded
                                    </Badge>
                                    <Badge variant="outline" className="text-[11px]">
                                      {entry.source === "bulk" ? "Bulk" : "Single"}
                                    </Badge>
                                    <Badge variant="outline" className="text-[11px]">
                                      Code {entry.ean}
                                    </Badge>
                                  </div>
                                  <span className="text-[13px] leading-[18px] text-muted-foreground">
                                    {formatTime24(entry.createdAt)}
                                  </span>
                                </div>

                                <p className="mt-2 line-clamp-2 text-base leading-6 font-medium">
                                  {entry.item.title ?? "Untitled product"}
                                </p>

                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[13px] leading-[18px] text-muted-foreground">
                                    ASIN {entry.item.asin} · {entry.item.productType ?? "Unknown product type"}
                                  </p>
                                  <span className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] leading-[18px]">
                                    View
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>

                      <Separator />

                      {errorMessage ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/15 p-3">
                          <p className="text-[13px] leading-[18px] text-destructive">{errorMessage}</p>
                          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onRetry}>
                            Try again
                          </Button>
                        </div>
                      ) : successMessage ? (
                        <p className="rounded-md bg-emerald-500/15 px-3 py-2 text-[13px] leading-[18px] text-emerald-100">
                          {successMessage}
                        </p>
                      ) : (
                        <p className="text-[13px] leading-[18px] text-muted-foreground">
                          Enter EAN, UPC, or GTIN to start lookup.
                        </p>
                      )}

                      {bulkCards.some((card) => card.status === "error") ? (
                        <div className="space-y-2 rounded-md bg-destructive/10 p-3">
                          <p className="text-[13px] leading-[18px] font-medium text-destructive">Bulk errors</p>
                          {bulkCards
                            .filter((card): card is BulkErrorCard => card.status === "error")
                            .slice(0, 5)
                            .map((card) => (
                              <p key={`error-${card.ean}`} className="text-[13px] leading-[18px] text-destructive/90">
                                {card.ean}: {card.message}
                              </p>
                            ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <div className="md:col-span-4 md:flex md:justify-end">
                    <Card className="w-full xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:max-w-[360px] xl:self-start">
                      <CardHeader className="space-y-1">
                        <CardTitle className="text-[22px] leading-7 font-semibold tracking-tight">
                          Result Details
                        </CardTitle>
                        <CardDescription className="text-[13px] leading-[18px] text-muted-foreground">
                          Select a result from Results Preview to see pricing, fees, and match confidence.
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="space-y-5 xl:overflow-y-auto xl:pb-5">
                        {!selectedEntry ? (
                          <div className="space-y-1 rounded-md bg-muted/50 p-4">
                            <p className="text-base leading-6 font-medium">Result Details</p>
                            <p className="text-[13px] leading-[18px] text-muted-foreground">
                              Select a result from Results Preview to see pricing, fees, and match confidence.
                            </p>
                          </div>
                        ) : (
                          <>
                            <section className="space-y-3">
                              <h3 className="text-[14px] leading-5 font-medium text-foreground/90">
                                Product Snapshot
                              </h3>
                              {selectedEntry.item.images?.[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  className="h-60 w-full rounded-lg bg-muted/20 object-contain p-2"
                                  src={selectedEntry.item.images[0]}
                                  alt={selectedEntry.item.title ?? selectedEntry.item.asin}
                                />
                              ) : (
                                <div className="flex h-52 items-center justify-center rounded-lg bg-muted/20 text-[13px] leading-[18px] text-muted-foreground">
                                  No image available
                                </div>
                              )}

                              <div className="space-y-1.5">
                                <h2 className="text-base leading-6 font-semibold">
                                  <a
                                    href={getAmazonProductUrl(
                                      selectedEntry.item.asin,
                                      selectedEntry.marketplaceId,
                                    )}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline-offset-4 transition-colors hover:text-primary hover:underline"
                                  >
                                    {selectedEntry.item.title ?? "Untitled Product"}
                                  </a>
                                </h2>
                                <p className="text-[13px] leading-[18px] text-muted-foreground">
                                  EAN: {selectedEntry.ean}
                                </p>
                                <p className="text-[13px] leading-[18px] text-muted-foreground">
                                  ASIN: {selectedEntry.item.asin}
                                </p>
                                <p className="text-[13px] leading-[18px] text-muted-foreground">
                                  Product Type: {selectedEntry.item.productType ?? "Unknown"}
                                </p>
                              </div>
                            </section>

                            <Separator />

                            <section className="space-y-3">
                              <h3 className="text-[14px] leading-5 font-medium text-foreground/90">
                                Match / Confidence
                              </h3>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">Source: {selectedEntry.source}</Badge>
                                <Badge variant="outline">Rank: #{selectedEntry.rank}</Badge>
                                <Badge
                                  className={cn(
                                    getConfidenceLabel(selectedEntry.rank) === "High" &&
                                      "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
                                    getConfidenceLabel(selectedEntry.rank) === "Medium" &&
                                      "border-blue-400/30 bg-blue-500/15 text-blue-200",
                                    getConfidenceLabel(selectedEntry.rank) === "Low" &&
                                      "border-red-400/30 bg-red-500/15 text-red-200",
                                  )}
                                >
                                  {getConfidenceLabel(selectedEntry.rank)} confidence
                                </Badge>
                              </div>
                            </section>

                            <Separator />

                            <section className="space-y-3">
                              <h3 className="text-[14px] leading-5 font-medium text-foreground/90">
                                Key Metrics
                              </h3>
                              <div className="space-y-2 rounded-lg bg-muted/30 p-4 text-[13px] leading-[18px]">
                                <p>
                                  Price:{" "}
                                  {formatCurrency(
                                    selectedEntry.enrichment?.pricing?.landedPrice ?? null,
                                    selectedEntry.enrichment?.pricing?.currency ?? null,
                                  )}
                                </p>
                                <p>Fees: {formatFees(selectedEntry.enrichment)}</p>
                                <p>Stock: {formatStock(selectedEntry.enrichment)}</p>
                              </div>
                              {selectedEntry.enrichment?.warnings.length ? (
                                <p className="text-[13px] leading-[18px] text-amber-300">
                                  {selectedEntry.enrichment.warnings.join(" | ")}
                                </p>
                              ) : null}
                            </section>

                            <Separator />

                            <section className="space-y-3">
                              <h3 className="text-[14px] leading-5 font-medium text-foreground/90">Actions</h3>
                              <Button asChild className="h-10 w-full">
                                <a
                                  href={getAmazonProductUrl(selectedEntry.item.asin, selectedEntry.marketplaceId)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open on Amazon
                                </a>
                              </Button>
                            </section>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
      </main>
    </div>
  );
}
