import { createContext, useContext } from "react";
import type { KonomiApi } from "./types";

const ApiContext = createContext<KonomiApi | null>(null);

export const ApiProvider = ApiContext.Provider;

export function useApi(): KonomiApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi() called outside <ApiProvider>");
  return api;
}
