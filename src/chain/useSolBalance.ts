import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// Live SOL balance for the connected wallet (polled every 15s). Returns null
// when no wallet is connected.
export function useSolBalance(): number | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        if (active) setBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        // Ignore transient devnet RPC errors.
      }
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [connection, publicKey]);

  return balance;
}
