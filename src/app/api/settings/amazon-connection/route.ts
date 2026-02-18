import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security/tokenCrypto";

export const runtime = "nodejs";

const saveConnectionSchema = z.object({
  sellerId: z.string().trim().min(1),
  marketplaceId: z.string().trim().min(1),
  lwaClientId: z.string().trim().min(1),
  refreshToken: z.string().trim().optional(),
});

export async function GET(): Promise<NextResponse> {
  const connection = await prisma.amazonConnection.findFirst({
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!connection) {
    return NextResponse.json({ connection: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      connection: {
        id: connection.id,
        sellerId: connection.sellerId,
        marketplaceId: connection.marketplaceId,
        lwaClientId: connection.lwaClientId,
        hasRefreshToken: Boolean(connection.refreshTokenEncrypted),
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = (await request.json()) as unknown;
    const payload = saveConnectionSchema.parse(json);

    const existing = await prisma.amazonConnection.findUnique({
      where: {
        sellerId_marketplaceId: {
          sellerId: payload.sellerId,
          marketplaceId: payload.marketplaceId,
        },
      },
    });

    if (!payload.refreshToken && !existing?.refreshTokenEncrypted) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "refreshToken is required for new connections",
          },
        },
        { status: 400 },
      );
    }

    let encryptedRefreshToken = existing?.refreshTokenEncrypted;

    if (payload.refreshToken) {
      encryptedRefreshToken = encryptSecret(payload.refreshToken);
    } else if (existing?.refreshTokenEncrypted) {
      // Re-encrypt existing tokens with the active primary key policy.
      encryptedRefreshToken = encryptSecret(decryptSecret(existing.refreshTokenEncrypted));
    }

    const connection = await prisma.amazonConnection.upsert({
      where: {
        sellerId_marketplaceId: {
          sellerId: payload.sellerId,
          marketplaceId: payload.marketplaceId,
        },
      },
      update: {
        lwaClientId: payload.lwaClientId,
        refreshTokenEncrypted: encryptedRefreshToken!,
      },
      create: {
        sellerId: payload.sellerId,
        marketplaceId: payload.marketplaceId,
        lwaClientId: payload.lwaClientId,
        refreshTokenEncrypted: encryptedRefreshToken!,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        connection: {
          id: connection.id,
          sellerId: connection.sellerId,
          marketplaceId: connection.marketplaceId,
          lwaClientId: connection.lwaClientId,
          hasRefreshToken: true,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: error.issues.map((issue) => issue.message).join(", "),
          },
        },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : "Failed to save connection";

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
