import { ANIMALS } from '../game/animals';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';

export function AnimalsPanel({ onClose }: { onClose: () => void }) {
  const { coins, animalCounts, progress } = useGameState();

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>🐔 Ranch &amp; Orchard</h3>
        <span className="muted">they produce goods over time — click them to collect</span>
        <button className="x" onClick={onClose}>
          <img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" />
        </button>
      </div>
      <div className="rows">
        {ANIMALS.map((a) => {
          const owned = animalCounts[a.id] ?? 0;
          const locked = progress.level < a.unlockLevel;
          const afford = coins >= a.cost;
          return (
            <div className={`row ${locked ? 'locked' : ''}`} key={a.id} style={{ borderLeftColor: a.category === 'tree' ? '#5fae4a' : '#e0a23c' }}>
              <img className="crop-ico-sm" src={a.icon} alt="" />
              <span className="row-name">
                {a.name}
                <span className="row-sub">
                  {a.productName} (+{a.productValue.toLocaleString()}🪙) every {Math.round(a.layMs / 1000)}s
                </span>
              </span>
              <span className="stock">×{owned}</span>
              <button
                className="btn sm"
                disabled={locked || !afford}
                onClick={() => bus.emit('ui:buyAnimal', a.id)}
              >
                {locked ? `Lv ${a.unlockLevel}` : `${a.cost.toLocaleString()}🪙`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
