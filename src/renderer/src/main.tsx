import "./assets/globals.css";
import "@/lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import { BootstrapApp } from "./bootstrap-app";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BootstrapApp />
  </React.StrictMode>,
);
