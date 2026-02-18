"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface InitialConnection {
  sellerId: string;
  marketplaceId: string;
  lwaClientId: string;
  hasRefreshToken: boolean;
}

interface AmazonConnectionFormProps {
  initialConnection: InitialConnection | null;
}

export function AmazonConnectionForm({
  initialConnection,
}: AmazonConnectionFormProps) {
  const internalApiToken = process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN?.trim();
  const [sellerId, setSellerId] = useState(initialConnection?.sellerId ?? "");
  const [marketplaceId, setMarketplaceId] = useState(
    initialConnection?.marketplaceId ?? process.env.NEXT_PUBLIC_DEFAULT_MARKETPLACE_ID ?? "",
  );
  const [lwaClientId, setLwaClientId] = useState(initialConnection?.lwaClientId ?? "");
  const [refreshToken, setRefreshToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"success" | "error" | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSaving(true);
    setStatusMessage(null);
    setStatusKind(null);

    try {
      const response = await fetch("/api/settings/amazon-connection", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(internalApiToken
            ? {
                "x-internal-api-token": internalApiToken,
              }
            : {}),
        },
        body: JSON.stringify({
          sellerId,
          marketplaceId,
          lwaClientId,
          refreshToken,
        }),
      });

      const payload = (await response.json()) as {
        error?: {
          message?: string;
        };
      };

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Failed to save connection");
      }

      setStatusKind("success");
      setStatusMessage("Amazon connection saved.");
      setRefreshToken("");
    } catch (error) {
      setStatusKind("error");
      setStatusMessage(error instanceof Error ? error.message : "Failed to save connection");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Amazon Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Seller ID
              </label>
              <Input
                value={sellerId}
                onChange={(event) => setSellerId(event.target.value)}
                placeholder="A123EXAMPLE"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Marketplace ID
              </label>
              <Input
                value={marketplaceId}
                onChange={(event) => setMarketplaceId(event.target.value)}
                placeholder="A1F83G8C2ARO7P"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              LWA Client ID
            </label>
            <Input
              value={lwaClientId}
              onChange={(event) => setLwaClientId(event.target.value)}
              placeholder="amzn1.application-oa2-client.xxx"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Refresh Token (encrypted at rest)
            </label>
            <Textarea
              value={refreshToken}
              onChange={(event) => setRefreshToken(event.target.value)}
              placeholder={
                initialConnection?.hasRefreshToken
                  ? "Enter a new refresh token to rotate credentials"
                  : "Atzr|..."
              }
              required={!initialConnection?.hasRefreshToken}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save connection"}
            </Button>
            {statusMessage ? (
              <p
                className={`text-sm ${
                  statusKind === "success" ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {statusMessage}
              </p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Existing token is stored securely. Leave Refresh Token empty to keep current token.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
