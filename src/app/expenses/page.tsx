"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ExpenseItem {
  id: string;
  date: string;
  amount: number;
  currency: string;
  category: string;
  notes: string | null;
  recurring: boolean;
  isActive: boolean;
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const total30d = useMemo(() => {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 30);
    return expenses
      .filter((expense) => new Date(expense.date) >= from)
      .reduce((sum, expense) => sum + expense.amount, 0);
  }, [expenses]);

  const loadExpenses = useCallback(async () => {
    const response = await fetch("/api/expenses", { cache: "no-store" });
    const payload = (await response.json()) as {
      expenses?: ExpenseItem[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Failed to load expenses.");
    }

    setExpenses(payload.expenses ?? []);
  }, []);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsSaving(true);
      setMessage(null);

      try {
        const parsedAmount = Number.parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error("Enter a valid expense amount.");
        }

        const response = await fetch("/api/expenses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            date,
            amount: parsedAmount,
            category,
            notes: notes.trim() || undefined,
            recurring,
          }),
        });

        const payload = (await response.json()) as { error?: { message?: string } };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Failed to save expense.");
        }

        setAmount("");
        setCategory("");
        setNotes("");
        setRecurring(false);
        setMessage("Expense saved.");
        await loadExpenses();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save expense.");
      } finally {
        setIsSaving(false);
      }
    },
    [amount, category, date, loadExpenses, notes, recurring],
  );

  return (
    <section className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Track recurring and one-off business expenses alongside Amazon data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Expense</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]" onSubmit={onSubmit}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Amount"
            />
            <Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" />
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
              />
              Recurring
            </label>
            <Button type="submit" disabled={isSaving} className="md:col-span-5 md:w-fit">
              {isSaving ? "Saving..." : "Save Expense"}
            </Button>
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expense Ledger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Last 30 days total: £{total30d.toFixed(2)}</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Recurring</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No expenses yet.
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense.id} className="border-t">
                      <td className="px-3 py-2">{new Date(expense.date).toLocaleDateString("en-GB")}</td>
                      <td className="px-3 py-2">{expense.category}</td>
                      <td className="px-3 py-2">{expense.amount.toFixed(2)} {expense.currency}</td>
                      <td className="px-3 py-2">{expense.recurring ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{expense.notes ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
