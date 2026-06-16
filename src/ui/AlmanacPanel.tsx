import { PLANTS, RARITY, MUTATIONS } from '../game/economy';
import { ACHIEVEMENTS } from '../game/progression';
import { useGameState } from './useGameState';
import { CropIcon } from './CropIcon';

export function AlmanacPanel({ onClose }: { onClose: () => void }) {
  const { progress } = useGameState();
  const dp = new Set(progress.discoveredPlants);
  const dm = new Set(progress.discoveredMutations);
  const ach = new Set(progress.achievements);
  const plantPct = Math.round((dp.size / PLANTS.length) * 100);
  const muts = MUTATIONS.filter((m) => m.id !== 'normal');

  return (
    <div className="panel almanac">
      <div className="panel-head">
        <h3>📖 Almanac</h3>
        <span className="muted">
          {dp.size}/{PLANTS.length} plants · {ach.size}/{ACHIEVEMENTS.length} achievements
        </span>
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      <div className="alm-body">
        <h4>Plants — {plantPct}% discovered</h4>
        <div className="alm-grid">
          {PLANTS.map((p) => {
            const found = dp.has(p.id);
            const r = RARITY[p.rarity];
            return (
              <div
                className={`alm-cell ${found ? '' : 'locked'}`}
                key={p.id}
                style={found ? { borderColor: r.css } : undefined}
              >
                {found && <CropIcon id={p.id} className="crop-ico" />}
                <span className="alm-name">{found ? p.name : '???'}</span>
                {found && <span className="alm-rar" style={{ color: r.css }}>{p.rarity}</span>}
              </div>
            );
          })}
        </div>

        <h4>Mutations — {dm.size}/{muts.length} found</h4>
        <div className="alm-tags">
          {muts.map((m) => {
            const found = dm.has(m.id);
            return (
              <span
                key={m.id}
                className="alm-tag"
                style={{ color: found ? m.css : '#6b7280', borderColor: found ? m.css : '#3a4250' }}
              >
                {found ? `${m.name} ×${m.mult}` : '???'}
              </span>
            );
          })}
        </div>

        <h4>Achievements</h4>
        <div className="rows">
          {ACHIEVEMENTS.map((a) => {
            const done = ach.has(a.id);
            return (
              <div className={`row ${done ? 'sel' : ''}`} key={a.id}>
                <span className="ach-mark">{done ? '🏆' : '🔒'}</span>
                <span className="row-name">
                  {a.name}
                  <span className="row-sub">{a.desc}</span>
                </span>
                <span className="row-meta">+{a.reward.toLocaleString()}🪙</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
