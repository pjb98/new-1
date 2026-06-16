import React, { useEffect, useRef, useState } from "react";
import { WEED_TOKEN_REQUIRED } from "./game/constants";
import { EventBus, EV } from "./game/EventBus";
import { ThreeApp } from "./game/ThreeApp";
import GameUI from "./ui/GameUI";
import { useWallet } from "./chain/WalletProvider";

export default function App() {
  const appRef = useRef<ThreeApp | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameReady, setGameReady] = useState(false);
  const { address, weedBalance, solBalance, connecting, connected, hasEnoughTokens, connect, disconnect } = useWallet();
  const devMode = new URLSearchParams(window.location.search).has("dev");

  useEffect(() => {
    if (!devMode && (!connected || !hasEnoughTokens)) return;
    if (appRef.current) return;
    if (!canvasRef.current) return;

    // Register before init — ThreeApp emits GAME_READY synchronously inside init()
    EventBus.once(EV.GAME_READY, () => setGameReady(true));
    const app = new ThreeApp();
    app.init(canvasRef.current);
    appRef.current = app;

    return () => {
      appRef.current?.destroy();
      appRef.current = null;
    };
  }, [connected, hasEnoughTokens]);

  // Sync weed token balance into game
  useEffect(() => {
    if (gameReady && weedBalance >= 0) {
      EventBus.emit("weed_tokens_updated", weedBalance);
    }
  }, [weedBalance, gameReady]);

  // ---- Connect screen ----
  if (!devMode && !connected) {
    return (
      <div style={{ minHeight: "100vh", background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: "#fff" }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: 40 }}>
          <div style={{ fontSize: 80, marginBottom: 16 }}>🌿</div>
          <div style={{ fontSize: 42, fontWeight: "bold", color: "#4caf50", marginBottom: 8 }}>Weed Sim</div>
          <div style={{ color: "#888", fontSize: 16, marginBottom: 32, lineHeight: 1.6 }}>
            Grow rare strains. Build your empire.<br />
            Sell on the streets. Don't get caught.
          </div>
          <div style={{ background: "#1e1e2e", border: "1px solid #333", borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ color: "#00e676", fontWeight: "bold", marginBottom: 8, fontSize: 16 }}>🔐 Token-Gated Access</div>
            <div style={{ color: "#aaa", fontSize: 14, lineHeight: 1.6 }}>
              You need <b style={{ color: "#00e676" }}>{WEED_TOKEN_REQUIRED.toLocaleString()} $WEED tokens</b> in your wallet to play.<br />
              $WEED tokens unlock premium strains, fertilizer, cosmetics, and VIP customers in-game.
            </div>
          </div>
          <button onClick={connect} disabled={connecting} style={{ background: connecting ? "#333" : "#4caf50", color: "#fff", border: "none", borderRadius: 8, padding: "14px 40px", fontSize: 18, fontWeight: "bold", cursor: connecting ? "not-allowed" : "pointer", marginBottom: 12 }}>
            {connecting ? "Connecting..." : "Connect Wallet"}
          </button>
          <div style={{ color: "#555", fontSize: 12, marginTop: 8 }}>Supports Phantom & Solflare (Devnet)</div>
        </div>
      </div>
    );
  }

  // ---- Not enough tokens screen ----
  if (!devMode && connected && !hasEnoughTokens) {
    return (
      <div style={{ minHeight: "100vh", background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: "#fff" }}>
        <div style={{ textAlign: "center", maxWidth: 500, padding: 40 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🔒</div>
          <div style={{ fontSize: 28, fontWeight: "bold", color: "#ff5252", marginBottom: 8 }}>Insufficient $WEED</div>
          <div style={{ background: "#1e1e2e", border: "1px solid #333", borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ color: "#aaa", fontSize: 14, marginBottom: 8 }}>Connected: <b style={{ color: "#fff" }}>{address?.slice(0, 6)}...{address?.slice(-4)}</b></div>
            <div style={{ color: "#aaa", fontSize: 14, marginBottom: 4 }}>SOL Balance: <b style={{ color: "#fff" }}>{solBalance.toFixed(4)} SOL</b></div>
            <div style={{ color: "#ff5252", fontSize: 16, marginTop: 8 }}>
              Your $WEED: <b>{weedBalance.toLocaleString()}</b><br />
              Required: <b style={{ color: "#00e676" }}>{WEED_TOKEN_REQUIRED.toLocaleString()}</b>
            </div>
          </div>
          <div style={{ color: "#aaa", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
            Purchase <b style={{ color: "#00e676" }}>$WEED tokens</b> to access the game.<br />
            Tokens give you in-game perks: premium fertilizer, exclusive strains, VIP customers, and room cosmetics.
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button onClick={disconnect} style={{ padding: "10px 24px", background: "#333", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
              Disconnect
            </button>
          </div>

          {/* Dev bypass for testing */}
          <div style={{ marginTop: 32, padding: 16, background: "#111", borderRadius: 8, border: "1px dashed #333" }}>
            <div style={{ color: "#555", fontSize: 11, marginBottom: 8 }}>🛠 Dev Mode (devnet testing)</div>
            <button onClick={() => {
              const current = parseInt(localStorage.getItem("dev_weed_balance") ?? "0");
              localStorage.setItem("dev_weed_balance", String(current + 5000));
              window.location.reload();
            }} style={{ padding: "6px 14px", background: "#1a2e1a", color: "#00e676", border: "1px solid #00e676", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
              Simulate +5,000 $WEED (devnet)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Game ----
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0d0d0d", overflow: "hidden", position: "relative" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, display: "block" }} />
      {gameReady && <GameUI walletAddress={address} weedTokenBalance={weedBalance} />}
    </div>
  );
}
