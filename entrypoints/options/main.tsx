import React from "react";
import ReactDOM from "react-dom/client";
import { OptionsApp } from "@/src/ui/options/OptionsApp";
import "@/src/ui/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
