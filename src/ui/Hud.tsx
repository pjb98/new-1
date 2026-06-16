import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useSolBalance } from '../chain/useSolBalance';
import { useGameState, useClock } from './useGameState';
import { sfx } from '../game/audio';
import { pendingChoices } from '../game/skills';

// Day/night get cropped weather-sheet sprites; dawn/dusk keep their emoji
// (no clean pixel match in the pack). `emoji` doubles as the img alt text.
const PHASE_ICON: Record<string, { emoji: string; img?: string }> = {
  dawn: { emoji: '🌅', img: 'assets/sprout-ui/phase_dawn.png' },
  day: { emoji: '☀️', img: 'assets/sprout-ui/phase_day.png' },
  dusk: { emoji: '🌇', img: 'assets/sprout-ui/phase_dusk.png' },
  night: { emoji: '🌙', img: 'assets/sprout-ui/phase_night.png' },
};

export type Panel = 'shop' | 'seeds' | 'bag' | 'animals' | 'upgrades' | 'skills' | 'almanac' | 'help' | null;

// `emoji` is the original glyph (kept as img alt, or rendered as-is when no
// pixel icon exists — almanac has no clean book sprite in the pack).
// Colorful Sprout Lands game-art icons for the content buttons (coin, seed,
// basket, chicken, hoe, star, book); help/sound stay crisp monochrome utility
// glyphs. `emoji` is kept only as the img alt text.
const BUTTONS: Array<{ id: Exclude<Panel, null>; emoji: string; img?: string; label: string }> = [
  { id: 'shop', emoji: '🛒', img: 'assets/sprout-ui/ic_cart_brown.png', label: 'Strain Shop' },
  { id: 'seeds', emoji: '🌿', img: 'assets/sprout-ui/ic_seedcat.png', label: 'My Strains' },
  { id: 'bag', emoji: '💰', img: 'assets/sprout-ui/icon_basket.png', label: 'Stash' },
  { id: 'animals', emoji: '🐔', img: 'assets/sprout-ui/icon_chicken.png', label: 'Side Hustle' },
  { id: 'upgrades', emoji: '⬆️', img: 'assets/sprout-ui/dn_day.png', label: 'Grow Op' },
  { id: 'skills', emoji: '🎯', img: 'assets/sprout-ui/icon_star.png', label: 'Skills' },
  { id: 'almanac', emoji: '📖', img: 'assets/sprout-ui/icon_almanac.png', label: 'Strainpedia' },
  { id: 'help', emoji: '❔', img: 'assets/sprout-ui/btn_help.png', label: 'Help' },
];

export function Hud({
  panel,
  onToggle,
}: {
  panel: Panel;
  onToggle: (p: Exclude<Panel, null>) => void;
}) {
  const { publicKey } = useWallet();
  const sol = useSolBalance();
  const { coins, progress, skills, perks } = useGameState();
  const { day, clock, phase } = useClock();
  const perkChoices = pendingChoices(skills, perks).length;

  const addr = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null;
  const xpPct = progress.xpNeed > 0 ? Math.min(100, (progress.xpInto / progress.xpNeed) * 100) : 100;
  const [muted, setMuted] = useState(() => sfx.isMuted());

  return (
    <div className="hud">
      <div className="hud-left">
        <div className="daynight" title={`Day ${day} · ${clock}`}>
          <img className="dn-frame" src={`assets/sprout-ui/widget_${phase}.png?6`} alt={PHASE_ICON[phase].emoji} />
          <span className="dn-date">Day {day} · {clock}</span>
        </div>
        <div className="hud-stats">
          <span className="badge coins">
            <img className="hud-icon" src="assets/sprout-ui/icon_coin.png" alt="🪙" />
            {coins.toLocaleString()}
          </span>
          <span className="badge lvl" title={`${progress.xpInto}/${progress.xpNeed} XP`}>
            <img className="hud-icon" src="assets/sprout-ui/icon_star.png" alt="⭐" /> Lv {progress.level}
            <span className="xpbar"><span className="xpfill" style={{ width: `${xpPct}%` }} /></span>
          </span>
        </div>
      </div>
      <div className="hud-buttons">
        {BUTTONS.map((b) => {
          const showDot = b.id === 'skills' && perkChoices > 0;
          return (
            <button
              key={b.id}
              className={`iconbtn ${panel === b.id ? 'active' : ''}`}
              onClick={() => onToggle(b.id)}
              title={showDot ? `${b.label} — ${perkChoices} perk choice${perkChoices > 1 ? 's' : ''} available!` : b.label}
              style={showDot ? { position: 'relative' } : undefined}
            >
              {b.img ? <img className="btn-ico" src={b.img} alt={b.emoji} /> : b.emoji}
              {showDot && (
                <span
                  style={{
                    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16,
                    padding: '0 3px', borderRadius: 8, background: '#e6433a', color: '#fff',
                    fontSize: 10, lineHeight: '16px', textAlign: 'center', fontWeight: 700,
                    border: '2px solid #fff3d8', boxSizing: 'border-box',
                  }}
                >
                  {perkChoices}
                </span>
              )}
            </button>
          );
        })}
        <button
          className="iconbtn"
          title={muted ? 'Unmute' : 'Mute'}
          onClick={() => {
            sfx.resume();
            const next = !muted;
            sfx.setMuted(next);
            setMuted(next);
          }}
        >
          <img
            className="btn-ico"
            src={`assets/sprout-ui/btn_sound_${muted ? 'off' : 'on'}.png`}
            alt={muted ? '🔇' : '🔊'}
          />
        </button>
      </div>
      <div className="hud-right">
        {addr && (
          <span className="badge">
            {addr}
            {sol !== null ? ` · ${sol.toFixed(2)} SOL` : ''}
          </span>
        )}
        <WalletMultiButton />
      </div>
    </div>
  );
}
