import { UPGRADES } from '../game/progression';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';

export function UpgradesPanel({ onClose }: { onClose: () => void }) {
  const { coins, progress } = useGameState();
  const up = progress.upgrades;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>⬆️ Upgrades</h3>
        <span className="muted">permanent boosts</span>
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      <div className="rows">
        {UPGRADES.map((u) => {
          const lvl = up[u.id] ?? 0;
          const maxed = lvl >= u.max;
          const cost = maxed ? 0 : u.cost(lvl);
          const afford = coins >= cost;
          return (
            <div className="row" key={u.id} style={{ borderLeftColor: '#7bd66a' }}>
              <img className="upg-icon-img" src={u.icon} alt="" />
              <span className="row-name">
                {u.name} <span className="lvltag">Lv {lvl}/{u.max}</span>
                <span className="row-sub">
                  {u.desc(lvl)}
                  {!maxed && <span className="next"> → {u.desc(lvl + 1)}</span>}
                </span>
              </span>
              <button
                className="btn sm"
                disabled={maxed || !afford}
                onClick={() => bus.emit('ui:buyUpgrade', u.id)}
              >
                {maxed ? 'MAX' : `${cost.toLocaleString()}🪙`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
