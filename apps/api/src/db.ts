import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Parse a JSON text column, falling back to a default on corruption. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
