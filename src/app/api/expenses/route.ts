import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const saveExpenseSchema = z.object({
  date: z.string().trim().min(1),
  amount: z.number().finite().positive(),
  currency: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1),
  notes: z.string().trim().optional(),
  recurring: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function parseDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const fromRaw = requestUrl.searchParams.get("from");
  const toRaw = requestUrl.searchParams.get("to");

  const from = fromRaw ? parseDate(fromRaw) : null;
  const to = toRaw ? parseDate(toRaw) : null;

  const expenses = await prisma.expense.findMany({
    where:
      from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : undefined,
    orderBy: {
      date: "desc",
    },
    take: 500,
  });

  return NextResponse.json(
    {
      ok: true,
      expenses: expenses.map((expense) => ({
        id: expense.id,
        date: expense.date.toISOString(),
        amount: toNumber(expense.amount.toString()),
        currency: expense.currency,
        category: expense.category,
        notes: expense.notes,
        recurring: expense.recurring,
        isActive: expense.isActive,
        updatedAt: expense.updatedAt,
      })),
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const json = (await request.json()) as unknown;
    const payload = saveExpenseSchema.parse(json);
    const date = parseDate(payload.date);

    if (!date) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid expense date.",
          },
        },
        { status: 400 },
      );
    }

    const expense = await prisma.expense.create({
      data: {
        date,
        amount: payload.amount,
        currency: payload.currency ?? "GBP",
        category: payload.category,
        notes: payload.notes ?? null,
        recurring: payload.recurring ?? false,
        isActive: payload.isActive ?? true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        expense: {
          id: expense.id,
          date: expense.date.toISOString(),
          amount: toNumber(expense.amount.toString()),
          currency: expense.currency,
          category: expense.category,
          notes: expense.notes,
          recurring: expense.recurring,
          isActive: expense.isActive,
          updatedAt: expense.updatedAt,
        },
      },
      { status: 201 },
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

    const message = error instanceof Error ? error.message : "Failed to create expense";

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
