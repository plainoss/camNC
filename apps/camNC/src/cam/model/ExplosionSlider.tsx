/** Native range input keeps pointer, touch and keyboard scrubbing consistent. */
export function ExplosionSlider({ progress, onChange }: { progress: number; onChange: (progress: number) => void }) {
  const percent = Math.round(progress * 100);
  return (
    <label className="inline-flex items-center gap-2 text-xs">
      <span>Explosion</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="Explosion amount"
        aria-valuetext={`${percent}% exploded`}
        className="w-28 accent-primary"
        onChange={event => onChange(event.currentTarget.valueAsNumber / 100)}
      />
      <span className="w-8 tabular-nums">{percent}%</span>
    </label>
  );
}
