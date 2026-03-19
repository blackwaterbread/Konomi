import fs from "fs";
import path from "path";

const databaseDir = path.resolve(process.cwd(), "database");

fs.mkdirSync(databaseDir, { recursive: true });
console.log(`[db:prepare-dir] ready: ${databaseDir}`);
