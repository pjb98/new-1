import { RARITY, cropValue, parseStackKey } from '../game/economy';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';
import { CropIcon } from './CropIcon';

export function BagPanel({ onClose }: { onClose: () => void }) {
  const { harvest } = useGameState();
  let total = 0;
  const rows = Object.keys(harvest).map((k) => {
    const { plant, mutation, wet } = parseStackKey(k);
    const count = harvest[k];
    const unit = cropValue(plant, mutation, wet);
    total += unit * count;
    return { k, plant, mutation, wet, count, unit };
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>🎒 Harvest</h3>
        {rows.length > 0 && (
          <button className="btn sm gold" onClick={() => bus.emit('ui:sellAll', undefined)}>
            Sell all (+{total.toLocaleString()}🪙)
          </button>
        )}
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Nothing harvested yet. Plant a seed, water it, and wait for it to grow!</p>
      ) : (
        <div className="rows">
          {rows.map(({ k, plant, mutation, wet, count, unit }) => {
            const r = RARITY[plant.rarity];
            return (
              <div className="row" key={k} style={{ borderLeftColor: r.css }}>
                <span className="dot" style={{ background: r.css, color: r.css }} />
                <CropIcon id={plant.id} />
                <span className="row-name">
                  {plant.name}
                  <span className="rarity-line">
                    {mutation.id !== 'normal' && (
                      <span className="mut" style={{ color: mutation.css }}>{mutation.name}</span>
                    )}
                    {wet && <span className="mut wet">Wet</span>}
                  </span>
                </span>
                <span className="row-meta">{unit.toLocaleString()}🪙 ea</span>
                <span className="stock">×{count}</span>
                <button className="btn sm" onClick={() => bus.emit('ui:sellStack', k)}>Sell</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
