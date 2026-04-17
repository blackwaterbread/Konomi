import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma-server/client";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://root:mariadb@127.0.0.1:3306/konomi";

let client: PrismaClient | null = null;

export function getDB(): PrismaClient {
  if (!client) {
    const adapter = new PrismaMariaDb(DATABASE_URL);
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectDB(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}
