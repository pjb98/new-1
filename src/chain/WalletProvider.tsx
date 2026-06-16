import { type ReactNode, useMemo } from 'react';
import { clusterApiUrl } from '@solana/web3.js';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

// Wraps the app in Solana wallet context. Devnet for now so testing is free;
// switch to mainnet-beta once the on-chain program ships.
export function WalletProvider({ children }: { children: ReactNode }) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  // Cast to any to work around wallet-adapter FC type incompatibility with @types/react 18.3.x
  const CP = ConnectionProvider as any;
  const WP = SolanaWalletProvider as any;
  const MP = WalletModalProvider as any;
  return (
    <CP endpoint={endpoint}>
      <WP wallets={wallets} autoConnect>
        <MP>{children}</MP>
      </WP>
    </CP>
  );
}
