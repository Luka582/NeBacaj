export const NAME_MAX = 60
export const DESC_MAX = 300

export function CharCounter({ current, max }: { current: number; max: number }) {
  const near = max - current <= 10
  const over = current > max
  return (
    <span
      aria-live="polite"
      className={`text-[11px] font-semibold tabular-nums ${
        over ? 'text-red-600' : near ? 'text-amber-600' : 'text-slate-400'
      }`}
    >
      {current}/{max}
    </span>
  )
}
