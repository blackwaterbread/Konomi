import { parentPort } from "worker_threads";
import { readImageMetaForScan } from "@core/lib/image-meta";

parentPort!.on(
  "message",
  ({ id, filePath }: { id: number; filePath: string }) => {
    parentPort!.postMessage({ id, result: readImageMetaForScan(filePath) });
  },
);
