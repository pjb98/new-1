import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { WEED_TOKEN_MINT, WEED_TOKEN_REQUIRED } from "../game/constants";

interface WalletCtx {
  address: string | null;
  weedBalance: number;
  solBalance: number;
  connecting: boolean;
  connected: boolean;
  hasEnoughTokens: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  refetch: () => Promise<void>;
}

const Ctx = createContext<WalletCtx>({
  address: null, weedBalance: 0, solBalance: 0, connecting: false, connected: false,
  hasEnoughTokens: false, connect: async () => {}, disconnect: () => {}, refetch: async () => {},
});

export function useWallet() { return useContext(Ctx); }

const CONNECTION = new Connection(clusterApiUrl("devnet"), "confirmed");

function getPhantom(): any { return (window as any).phantom?.solana ?? (window as any).solana; }
function getSolflare(): any { return (window as any).solflare; }

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [weedBalance, setWeedBalance] = useState(0);
  const [solBalance, setSolBalance] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const fetchBalances = useCallback(async (pubkey: string) => {
    try {
      const pk = new PublicKey(pubkey);

      // SOL balance
      const lamports = await CONNECTION.getBalance(pk);
      setSolBalance(lamports / 1e9);

      // $WEED token balance (SPL token)
      try {
        const mintPk = new PublicKey(WEED_TOKEN_MINT);
        const tokenAccounts = await CONNECTION.getParsedTokenAccountsByOwner(pk, { mint: mintPk });
        const balance = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        setWeedBalance(balance);
      } catch {
        // Token doesn't exist on devnet yet — simulate balance from localStorage for dev
        const stored = parseInt(localStorage.getItem("dev_weed_balance") ?? "0");
        setWeedBalance(stored);
      }
    } catch (err) {
      console.warn("Balance fetch error:", err);
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const phantom = getPhantom();
      const solflare = getSolflare();
      const wallet = phantom?.isPhantom ? phantom : solflare?.isSolflare ? solflare : null;

      if (!wallet) {
        alert("Please install Phantom or Solflare wallet to play.\n\nhttps://phantom.app");
        return;
      }

      const resp = await wallet.connect();
      const pubkey = resp.publicKey.toString();
      setAddress(pubkey);
      setConnected(true);
      await fetchBalances(pubkey);

      wallet.on("disconnect", () => { setAddress(null); setConnected(false); });
      wallet.on("accountChanged", (pk: PublicKey | null) => {
        if (pk) { setAddress(pk.toString()); fetchBalances(pk.toString()); }
        else { setAddress(null); setConnected(false); }
      });
    } catch (err: any) {
      if (err?.code !== 4001) console.error("Connect error:", err);
    } finally {
      setConnecting(false);
    }
  }, [fetchBalances]);

  const disconnect = useCallback(() => {
    const phantom = getPhantom();
    phantom?.disconnect?.();
    getSolflare()?.disconnect?.();
    setAddress(null);
    setConnected(false);
    setWeedBalance(0);
  }, []);

  const refetch = useCallback(async () => {
    if (address) await fetchBalances(address);
  }, [address, fetchBalances]);

  // Auto-reconnect
  useEffect(() => {
    const phantom = getPhantom();
    if (phantom?.isConnected && phantom?.publicKey) {
      const pk = phantom.publicKey.toString();
      setAddress(pk);
      setConnected(true);
      fetchBalances(pk);
    }
  }, [fetchBalances]);

  const hasEnoughTokens = weedBalance >= WEED_TOKEN_REQUIRED;

  return (
    <Ctx.Provider value={{ address, weedBalance, solBalance, connecting, connected, hasEnoughTokens, connect, disconnect, refetch }}>
      {children}
    </Ctx.Provider>
  );
}
