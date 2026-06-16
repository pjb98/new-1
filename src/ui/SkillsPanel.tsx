import { SKILLS, skillInfo, skillLevel, MAX_SKILL_LEVEL, type Perk } from '../game/skills';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';

// Shows the five skills, each with an XP bar, three milestone perk choices
// (Lv 5/10/15, pick 1 of 2) and a Lv20 capstone. XP is earned by doing the
// matching activity; the chosen perks feed FarmScene's modifier aggregator.
export function SkillsPanel({ onClose }: { onClose: () => void }) {
  const { skills, perks } = useGameState();

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>🎯 Skills</h3>
        <span className="muted">level up by playing · choose a perk at Lv 5/10/15</span>
        <button className="x" onClick={onClose}><img className="ui-x" src="assets/sprout-ui/ui_x.png" alt="✕" /></button>
      </div>
      <div className="rows">
        {SKILLS.map((s) => {
          const xp = skills[s.id] ?? 0;
          const info = skillInfo(xp);
          const lvl = info.level;
          const pct = Math.round(info.pct * 100);
          const maxed = info.max;
          return (
            <div className="row" key={s.id} style={{ borderLeftColor: '#7bd66a', flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <img className="upg-icon-img" src={s.icon} alt="" />
                <span className="row-name" style={{ flex: 1 }}>
                  {s.name}{' '}
                  <span className="lvltag">
                    {maxed ? `Lv 20 ★${info.mastery}` : `Lv ${lvl}/${MAX_SKILL_LEVEL}`}
                  </span>
                  <span className="xpbar" style={{ display: 'block', width: '100%', margin: '4px 0' }}>
                    <span className="xpfill" style={{ width: maxed && info.mastery === 0 ? '100%' : `${pct}%` }} />
                  </span>
                  <span className="row-sub muted">{s.blurb}</span>
                </span>
              </div>

              {/* Milestone perk choices */}
              {s.milestones.map((ms) => {
                const key = `${s.id}:${ms.level}`;
                const chosenId = perks[key];
                const locked = skillLevel(xp) < ms.level;
                const chosen: Perk | null = chosenId === ms.a.id ? ms.a : chosenId === ms.b.id ? ms.b : null;
                return (
                  <div key={ms.level} style={{ marginTop: 6 }}>
                    {locked ? (
                      <span className="row-sub muted">🔒 Lv {ms.level} perk</span>
                    ) : chosen ? (
                      <span
                        className="row-sub"
                        style={{ display: 'block', color: '#bff58a', borderLeft: '3px solid #7bd66a', paddingLeft: 6 }}
                      >
                        ✓ <b>{chosen.name}</b> — {chosen.desc}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="row-sub" style={{ color: '#ffe27a' }}>★ Lv {ms.level} — choose a perk:</span>
                        {[ms.a, ms.b].map((p) => (
                          <button
                            key={p.id}
                            className="btn sm"
                            style={{ textAlign: 'left', whiteSpace: 'normal' }}
                            onClick={() => bus.emit('ui:choosePerk', { skill: s.id, level: ms.level, perk: p.id })}
                          >
                            <b>{p.name}</b> — {p.desc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Lv20 capstone */}
              <div style={{ marginTop: 6 }}>
                <span
                  className="row-sub"
                  style={{ display: 'block', opacity: maxed ? 1 : 0.5, color: maxed ? '#ffd21a' : undefined }}
                >
                  {maxed ? '🌟' : '🔒'} <b>{s.capstone.name}</b> (Lv 20) — {s.capstone.desc}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
