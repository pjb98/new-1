import { PLANTS, RARITY, RARITY_UNLOCK } from '../game/economy';
import { useGameState, useClock } from './useGameState';
import { bus } from '../game/EventBus';
import { CropIcon } from './CropIcon';

export function Shop({ onClose }: { onClose: () => void }) {
  const { coins, shop, progress } = useGameState();
  const { restockIn } = useClock();
  const stockById: Record<string, number> = Object.fromEntries(shop.map((s) => [s.plantId, s.stock]));
  const mm = String(Math.floor(restockIn / 60)).padStart(2, '0');
  const ss = String(restockIn % 60).padStart(2, '0');

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>🛒 Strain Shop</h3>
        <span className="muted">restock in {mm}:{ss}</span>
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      <div className="rows">
        {PLANTS.map((p) => {
          const r = RARITY[p.rarity];
          const locked = RARITY_UNLOCK[p.rarity] > progress.level;
          const stock = stockById[p.id] ?? 0;
          const afford = coins >= p.seedCost;
          return (
            <div className={`row ${locked ? 'locked' : ''}`} key={p.id} style={{ borderLeftColor: r.css }}>
              <span className="dot" style={{ background: r.css, color: r.css }} />
              <CropIcon id={p.id} kind="seed" />
              <span className="row-name">
                {p.name}
                <span className="rarity" style={{ color: r.css }}>{p.rarity}</span>
              </span>
              <span className="row-meta">{p.growthSeconds}s · {p.baseValue.toLocaleString()}🪙</span>
              <span className={`stock ${stock > 0 && !locked ? '' : 'out'}`}>
                {locked ? '🔒' : stock > 0 ? `×${stock}` : '—'}
              </span>
              <button
                className="btn sm"
                disabled={locked || stock <= 0 || !afford}
                onClick={() => bus.emit('ui:buySeed', p.id)}
              >
                {locked ? `Lv ${RARITY_UNLOCK[p.rarity]}` : `${p.seedCost.toLocaleString()}🪙`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
