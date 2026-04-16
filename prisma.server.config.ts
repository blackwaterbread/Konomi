import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/server/schema.prisma",
  datasource: {
    url: process.env["DATABASE_URL"] ?? "mysql://root:mariadb@127.0.0.1:3306/konomi",
  },
});
