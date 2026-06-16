// Crop / seed sprite with a graceful fallback. A few late-game and special
// crops don't have dedicated art yet; rather than show a broken image we fall
// back to the pack's generic seed-packet icon.
const FALLBACK = 'assets/sprout-ui/ic_seedcat.png';

export function CropIcon({
  id,
  kind = 'produce',
  className = 'crop-ico-sm',
}: {
  id: string;
  kind?: 'seed' | 'produce';
  className?: string;
}) {
  const src = kind === 'seed' ? `assets/crops/seed_${id}.png` : `assets/crops/${id}.png`;
  return (
    <img
      className={className}
      src={src}
      alt=""
      onError={(e) => {
        const el = e.currentTarget;
        el.onerror = null;
        el.src = FALLBACK;
      }}
    />
  );
}
