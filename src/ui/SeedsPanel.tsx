import { PLANTS, RARITY } from '../game/economy';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';
import { CropIcon } from './CropIcon';

export function SeedsPanel({ onClose }: { onClose: () => void }) {
  const { seeds, selectedSeed } = useGameState();
  const owned = PLANTS.filter((p) => (seeds[p.id] ?? 0) > 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>🌱 Your Seeds</h3>
        <span className="muted">click to plant with the seed tool</span>
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      {owned.length === 0 ? (
        <p className="empty">No seeds yet — buy some at the shop.</p>
      ) : (
        <div className="rows">
          {owned.map((p) => {
            const r = RARITY[p.rarity];
            return (
              <div className={`row ${selectedSeed === p.id ? 'sel' : ''}`} key={p.id} style={{ borderLeftColor: r.css }}>
                <span className="dot" style={{ background: r.css, color: r.css }} />
                <CropIcon id={p.id} kind="seed" />
                <span className="row-name">
                  {p.name}
                  <span className="rarity" style={{ color: r.css }}>{p.rarity}</span>
                </span>
                <span className="stock">×{seeds[p.id]}</span>
                <button className="btn sm" onClick={() => bus.emit('ui:selectSeed', p.id)}>
                  {selectedSeed === p.id ? 'Selected' : 'Select'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
