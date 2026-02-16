"use client";

import { CSSProperties, FormEvent, useCallback, useMemo, useState } from "react";
import {
  Building2,
  ChevronsUpDown,
  Moon,
  ScanLine,
  Sparkles,
  Sun,
} from "lucide-react";

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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import type {
  EnrichedCatalogData,
  EnrichedLookupResponse,
  LookupResultItem,
} from "@/lib/catalog/types";
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

type SelectionSource = "single" | "bulk";

type ScanSubsection = "single" | "bulk" | "results";

interface SelectionEntry {
  id: string;
  source: SelectionSource;
  ean: string;
  item: LookupResultItem;
  enrichment?: EnrichedCatalogData;
  marketplaceId?: string;
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
  const [isDark, setIsDark] = useState(true);
  const [activeSubsection, setActiveSubsection] = useState<ScanSubsection>("single");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      setSelectedId(null);
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
    setSelectedId(null);

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

  const failedBulkCount = useMemo(
    () => bulkCards.filter((card) => card.status === "error").length,
    [bulkCards],
  );

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
      });
    }

    return entries;
  }, [bulkCards, response]);

  const selectedEntry = useMemo(() => {
    if (selectionEntries.length === 0) {
      return null;
    }

    return selectionEntries.find((entry) => entry.id === selectedId) ?? selectionEntries[0];
  }, [selectedId, selectionEntries]);

  return (
    <div
      className={cn(
        isDark && "dark",
        "min-h-screen overflow-x-hidden bg-background text-foreground antialiased",
      )}
    >
      <div className="mx-auto w-full max-w-[1760px] p-3 md:p-6">
        <SidebarProvider
          defaultOpen
          style={
            {
              "--sidebar-width": "18rem",
              "--sidebar-width-icon": "3.5rem",
            } as CSSProperties
          }
          className="min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl shadow-black/20"
        >
          <Sidebar
            variant="inset"
            collapsible="icon"
            className="border-r border-sidebar-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80"
          >
            <SidebarHeader className="border-b p-3.5">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" className="h-12 gap-3 rounded-lg px-2.5">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">Acme Inc</span>
                      <span className="truncate text-xs text-muted-foreground">Enterprise</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>

            <SidebarContent className="overflow-x-hidden">
              <SidebarGroup>
                <SidebarGroupLabel className="px-2 text-[11px] uppercase tracking-[0.14em] text-sidebar-foreground/60">
                  Workflow
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive
                        tooltip="Scan"
                        className="h-9 rounded-md font-medium data-[active=true]:bg-sidebar-accent/70"
                      >
                        <ScanLine />
                        <span>Scan</span>
                      </SidebarMenuButton>
                      <SidebarMenuSub className="mt-1 pr-1">
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            href="#scan-single"
                            isActive={activeSubsection === "single"}
                            onClick={() => setActiveSubsection("single")}
                            className="h-8 rounded-md px-2 text-sm"
                          >
                            Single Barcode
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            href="#scan-bulk"
                            isActive={activeSubsection === "bulk"}
                            onClick={() => setActiveSubsection("bulk")}
                            className="h-8 rounded-md px-2 text-sm"
                          >
                            Bulk Barcodes
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            href="#scan-results"
                            isActive={activeSubsection === "results"}
                            onClick={() => setActiveSubsection("results")}
                            className="h-8 rounded-md px-2 text-sm"
                          >
                            Results Preview
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="shrink-0 space-y-2 border-t p-3">
              <Card className="border-border/70 bg-muted/30 shadow-none">
                <CardContent className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {isLoading || isBulkLoading ? "Running requests..." : "Ready for next lookup"}
                  </p>
                </CardContent>
              </Card>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton size="sm" className="h-9 rounded-md">
                    <Building2 />
                    <span>scan@acme.com</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset>
            <header className="flex h-16 items-center gap-2 border-b px-4 md:px-6">
              <SidebarTrigger />
              <div className="ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => setIsDark((value) => !value)}
                  aria-label="Toggle theme"
                >
                  {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
              </div>
            </header>

            <main className="flex-1 p-5 md:p-8">
              <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(390px,440px)]">
                <div className="space-y-7">
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Card className="rounded-xl">
                      <CardHeader className="space-y-1 pb-3">
                        <CardDescription className="text-xs uppercase tracking-wide text-muted-foreground/90">
                          Queued Codes
                        </CardDescription>
                        <CardTitle className="text-4xl font-semibold tracking-tight">{bulkCodesCount}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="rounded-xl">
                      <CardHeader className="space-y-1 pb-3">
                        <CardDescription className="text-xs uppercase tracking-wide text-muted-foreground/90">
                          Loaded Results
                        </CardDescription>
                        <CardTitle className="text-4xl font-semibold tracking-tight">
                          {selectionEntries.length}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                    <Card className="rounded-xl">
                      <CardHeader className="space-y-1 pb-3">
                        <CardDescription className="text-xs uppercase tracking-wide text-muted-foreground/90">
                          Failed Bulk
                        </CardDescription>
                        <CardTitle className="text-4xl font-semibold tracking-tight">{failedBulkCount}</CardTitle>
                      </CardHeader>
                    </Card>
                  </div>

                  <Card className="rounded-xl">
                    <CardHeader className="space-y-1 pb-4">
                      <CardTitle className="text-2xl tracking-tight">Scan</CardTitle>
                      <CardDescription className="text-sm text-muted-foreground">
                        Single scan, bulk scan, and results in one workspace.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-7">
                      <section id="scan-single" className="scroll-mt-20 space-y-3.5">
                        <h3 className="text-base font-semibold tracking-tight">Single Barcode</h3>
                        <form
                          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                          onSubmit={onSubmit}
                        >
                          <Input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="EAN / UPC / GTIN"
                            value={ean}
                            onFocus={() => setActiveSubsection("single")}
                            onChange={(event) => setEan(event.target.value)}
                            disabled={isLoading || isBulkLoading}
                            className="h-10"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            className="w-full px-4 sm:w-auto"
                            disabled={isLoading || isBulkLoading || normalizeCode(ean).length === 0}
                          >
                            {isLoading ? "Searching..." : "Search"}
                          </Button>
                        </form>
                      </section>

                      <Separator />

                      <section id="scan-bulk" className="scroll-mt-20 space-y-3.5">
                        <h3 className="text-base font-semibold tracking-tight">Bulk Barcodes</h3>
                        <Textarea
                          rows={7}
                          value={bulkInput}
                          onFocus={() => setActiveSubsection("bulk")}
                          onChange={(event) => setBulkInput(event.target.value)}
                          placeholder={"802297111261\n802297175317\n802297141565"}
                          disabled={isLoading || isBulkLoading}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <p className="text-sm text-muted-foreground">
                            {bulkCodesCount} unique code(s) queued
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            className="w-full px-4 sm:ml-auto sm:w-auto"
                            onClick={onRunBulk}
                            disabled={isLoading || isBulkLoading || bulkCodesCount === 0}
                          >
                            {isBulkLoading ? "Running..." : "Run bulk lookup"}
                          </Button>
                        </div>
                      </section>

                      <Separator />

                      <section id="scan-results" className="scroll-mt-20 space-y-3.5">
                        <h3 className="text-base font-semibold tracking-tight">Results Preview</h3>
                        {selectionEntries.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No results yet. Start scanning barcodes.
                          </p>
                        ) : (
                          <div className="space-y-3" onMouseEnter={() => setActiveSubsection("results")}>
                            {selectionEntries.map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                className={cn(
                                  "w-full rounded-lg border border-border/70 bg-card p-4 text-left transition-colors hover:bg-accent/40",
                                  selectedEntry?.id === entry.id && "border-primary/50 bg-accent/40",
                                )}
                                onClick={() => setSelectedId(entry.id)}
                              >
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="text-[11px]">
                                    {entry.source === "bulk" ? "Bulk" : "Single"}
                                  </Badge>
                                  <Badge variant="outline" className="text-[11px]">
                                    EAN {entry.ean}
                                  </Badge>
                                  <Badge variant="outline" className="text-[11px]">
                                    ASIN {entry.item.asin}
                                  </Badge>
                                </div>
                                <p className="line-clamp-2 text-base font-medium leading-snug">
                                  {entry.item.title ?? "Untitled Product"}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {entry.item.productType ?? "Unknown product type"}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>

                      <Separator />

                      {errorMessage ? (
                        <p className="text-sm text-destructive">{errorMessage}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {response
                            ? `${response.results.length} result${response.results.length === 1 ? "" : "s"}`
                            : "Enter a code to start"}
                        </p>
                      )}

                      {bulkCards.some((card) => card.status === "error") ? (
                        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
                          <p className="text-sm font-medium text-destructive">Bulk errors</p>
                          {bulkCards
                            .filter((card): card is BulkErrorCard => card.status === "error")
                            .slice(0, 5)
                            .map((card) => (
                              <p key={`error-${card.ean}`} className="text-xs text-destructive/90">
                                {card.ean}: {card.message}
                              </p>
                            ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <Card className="h-fit rounded-xl xl:sticky xl:top-8">
                  <CardHeader className="space-y-1 pb-4">
                    <CardTitle className="text-2xl tracking-tight">Right Window</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                      Live detail pane for selected result.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!selectedEntry ? (
                      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                        Select a result card to preview details here.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {selectedEntry.item.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="h-64 w-full rounded-lg border bg-muted/20 object-contain p-2"
                            src={selectedEntry.item.images[0]}
                            alt={selectedEntry.item.title ?? selectedEntry.item.asin}
                          />
                        ) : (
                          <div className="flex h-56 items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
                            No image available
                          </div>
                        )}

                        <div className="space-y-2.5">
                          <h2 className="text-xl font-semibold leading-tight">
                            <a
                              className="underline-offset-4 hover:underline"
                              href={getAmazonProductUrl(selectedEntry.item.asin, selectedEntry.marketplaceId)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {selectedEntry.item.title ?? "Untitled Product"}
                            </a>
                          </h2>
                          <p className="text-sm text-muted-foreground">EAN: {selectedEntry.ean}</p>
                          <p className="text-sm text-muted-foreground">ASIN: {selectedEntry.item.asin}</p>
                          <p className="text-sm text-muted-foreground">
                            Product Type: {selectedEntry.item.productType ?? "Unknown"}
                          </p>
                          {selectedEntry.item.brand ? (
                            <p className="text-sm text-muted-foreground">Brand: {selectedEntry.item.brand}</p>
                          ) : null}
                        </div>

                        <Separator />

                        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-4 text-sm leading-6">
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
                          <p className="text-xs text-amber-500 dark:text-amber-300">
                            {selectedEntry.enrichment.warnings.join(" | ")}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </div>
  );
}
