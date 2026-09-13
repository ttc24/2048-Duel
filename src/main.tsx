import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css"; // make sure this file exists in src/
import App from "./App"; // your 2048 component (default export)

const el = document.getElementById("root");
if (!el) throw new Error("Root element #root not found");
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
