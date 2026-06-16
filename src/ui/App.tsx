import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletProvider } from '../chain/WalletProvider';
import { createGame } from '../game/createGame';
import { Hud, type Panel } from './Hud';
import { Hotbar } from './Hotbar';
import { Shop } from './Shop';
import { SeedsPanel } from './SeedsPanel';
import { BagPanel } from './BagPanel';
import { AnimalsPanel } from './AnimalsPanel';
import { UpgradesPanel } from './UpgradesPanel';
import { SkillsPanel } from './SkillsPanel';
import { AlmanacPanel } from './AlmanacPanel';
import { HelpPanel } from './HelpPanel';
import { Toasts } from './Toasts';

const HELP_SEEN_KEY = 'solana-valley:seen-help';

function isDevBypassed(): boolean {
  return (
    localStorage.getItem('weed_token_bypass') === '1' ||
    new URLSearchParams(location.search).has('dev')
  );
}

function TokenGate() {
  const { disconnect } = useWallet();
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0d1a0d', color: '#fff', gap: 16, zIndex: 9999,
    }}>
      <h1 style={{ fontSize: 32, margin: 0 }}>🌿 $WEED Token Required</h1>
      <p style={{ margin: 0, color: '#a5d6a7', fontSize: 18 }}>
        You need 1,000 $WEED tokens to play
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          style={{
            padding: '10px 24px', background: '#2e7d32', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
          }}
          onClick={() => {
            localStorage.setItem('weed_token_bypass', '1');
            location.reload();
          }}
        >
          Dev Bypass
        </button>
        <button
          style={{
            padding: '10px 24px', background: '#b71c1c', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
          }}
          onClick={() => disconnect()}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function GameApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ReturnType<typeof createGame> | null>(null);
  // Show the how-to-play panel automatically on a player's first visit.
  const [panel, setPanel] = useState<Panel>(() =>
    localStorage.getItem(HELP_SEEN_KEY) ? null : 'help',
  );

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    gameRef.current = createGame(containerRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  // Enable the Sprout Lands premium UI skin only if its assets are present
  // (they're git-ignored), so the UI degrades to the default theme otherwise.
  useEffect(() => {
    const img = new Image();
    img.onload = () => document.documentElement.classList.add('ui-skin');
    img.src = 'assets/sprout-ui/ui_panel.png';
  }, []);

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const close = () => setPanel(null);
  const closeHelp = () => {
    localStorage.setItem(HELP_SEEN_KEY, '1');
    setPanel(null);
  };

  return (
    <div className="app">
      <div ref={containerRef} className="game-root" />
      <div className="overlay">
        <Hud panel={panel} onToggle={toggle} />
        {panel === 'shop' && <Shop onClose={close} />}
        {panel === 'seeds' && <SeedsPanel onClose={close} />}
        {panel === 'bag' && <BagPanel onClose={close} />}
        {panel === 'animals' && <AnimalsPanel onClose={close} />}
        {panel === 'upgrades' && <UpgradesPanel onClose={close} />}
        {panel === 'skills' && <SkillsPanel onClose={close} />}
        {panel === 'almanac' && <AlmanacPanel onClose={close} />}
        {panel === 'help' && <HelpPanel onClose={closeHelp} />}
        <Hotbar />
        <Toasts />
      </div>
    </div>
  );
}

function GatedApp() {
  const { connected } = useWallet();
  const bypassed = isDevBypassed();
  if (connected && !bypassed) {
    return <TokenGate />;
  }
  return <GameApp />;
}

export function App() {
  return (
    <WalletProvider>
      <GatedApp />
    </WalletProvider>
  );
}
