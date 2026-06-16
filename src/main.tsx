import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { WalletProvider } from "./chain/WalletProvider";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
