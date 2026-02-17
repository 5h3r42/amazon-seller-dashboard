import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const PRISMA_CLIENT_RUNTIME_VERSION = 2;
const projectRoot = process.cwd();
const fallbackDatabasePath = resolve(projectRoot, "prisma", "dev.db");
const fallbackDatabaseUrl = `file:${fallbackDatabasePath}`;

function normalizeDatabaseUrl(input: string | undefined): string {
  const raw = input?.trim();

  if (!raw) {
    return fallbackDatabaseUrl;
  }

  if (!raw.startsWith("file:")) {
    return raw;
  }

  const filePath = raw.slice("file:".length);

  if (!filePath) {
    return fallbackDatabaseUrl;
  }

  // Keep special URI forms (for example file://) untouched.
  if (filePath.startsWith("//")) {
    return raw;
  }

  const absolutePath = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  return `file:${absolutePath}`;
}

const resolvedDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

if (resolvedDatabaseUrl.startsWith("file:")) {
  const databasePath = resolvedDatabaseUrl.slice("file:".length);
  const databaseDir = dirname(databasePath);

  if (!existsSync(databaseDir)) {
    mkdirSync(databaseDir, { recursive: true });
  }

  if (!existsSync(databasePath)) {
    writeFileSync(databasePath, "");
  }
}

process.env.DATABASE_URL = resolvedDatabaseUrl;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaDatabaseUrl: string | undefined;
  prismaClientRuntimeVersion: number | undefined;
};

const shouldReuseClient =
  Boolean(globalForPrisma.prisma) &&
  globalForPrisma.prismaDatabaseUrl === resolvedDatabaseUrl &&
  globalForPrisma.prismaClientRuntimeVersion === PRISMA_CLIENT_RUNTIME_VERSION;

if (!shouldReuseClient) {
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }

  globalForPrisma.prisma = new PrismaClient({
    datasourceUrl: resolvedDatabaseUrl,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  globalForPrisma.prismaDatabaseUrl = resolvedDatabaseUrl;
  globalForPrisma.prismaClientRuntimeVersion = PRISMA_CLIENT_RUNTIME_VERSION;
}

const prismaClient = globalForPrisma.prisma;

if (!prismaClient) {
  throw new Error("Failed to initialize Prisma client");
}

export const prisma: PrismaClient = prismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
