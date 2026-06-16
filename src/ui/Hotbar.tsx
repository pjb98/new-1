import { TOOLS } from '../game/constants';
import { PLANT_BY_ID, RARITY } from '../game/economy';
import { useGameState } from './useGameState';
import { bus } from '../game/EventBus';

export function Hotbar() {
  const { selected, selectedSeed, seeds } = useGameState();
  const seedPlant = selectedSeed ? PLANT_BY_ID[selectedSeed] : null;
  const seedCount = selectedSeed ? seeds[selectedSeed] ?? 0 : 0;

  return (
    <div className="hotbar">
      {TOOLS.map((tool, i) => {
        const isSeed = tool.id === 'seed';
        const label = isSeed && seedPlant ? seedPlant.name : tool.label;
        const accent = isSeed && seedPlant ? RARITY[seedPlant.rarity].css : undefined;
        return (
          <button
            key={tool.id}
            className={`slot ${selected === tool.id ? 'selected' : ''}`}
            style={accent ? { borderColor: accent } : undefined}
            onClick={() => bus.emit('ui:selectTool', tool.id)}
            title={label}
          >
            <span className="slot-key">{i + 1}</span>
            <img
              className="tool-ico"
              src={
                isSeed
                  ? seedPlant
                    ? `assets/crops/seed_${seedPlant.id}.png`
                    : 'assets/sprout-ui/tool_seed.png'
                  : `assets/sprout-ui/${tool.id === 'hoe' ? 'tool_hoe' : 'tool_can'}.png`
              }
              alt={isSeed ? '🌱' : tool.id === 'hoe' ? '⛏️' : '💧'}
            />
            <span className="slot-label">{label}</span>
            {isSeed && <span className="slot-count">{seedCount}</span>}
          </button>
        );
      })}
    </div>
  );
}
