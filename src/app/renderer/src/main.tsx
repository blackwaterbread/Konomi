import "@/assets/globals.css";
import "@/lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import { ApiProvider } from "@/api";
import { createElectronApi } from "./api-impl";
import { BootstrapApp } from "@/bootstrap-app";

const api = createElectronApi();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ApiProvider value={api}>
      <BootstrapApp />
    </ApiProvider>
  </React.StrictMode>,
);
