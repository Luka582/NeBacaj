const SERBIA_TZ = 'Europe/Belgrade'

const belgradeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SERBIA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function belgradeParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = belgradeFormatter.formatToParts(date)
  const value = (type: string): number => {
    const found = parts.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function belgradeWallToUtcMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  for (let i = 0; i < 2; i++) {
    const wall = belgradeParts(new Date(ms))
    const wallTotal = wall.hour * 60 + wall.minute + wall.second / 60
    const targetTotal = h * 60 + mi + s / 60
    const diffMin = targetTotal - wallTotal
    if (diffMin === 0) break
    ms += diffMin * 60000
  }
  return ms
}

export function getSerbiaWeekday(): number {
  const parts = belgradeParts(new Date())
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

export function getSerbiaMinutes(): number {
  const parts = belgradeParts(new Date())
  return parts.hour * 60 + parts.minute
}

export function belgradeDateKey(offsetDays: number): string {
  const parts = belgradeParts(new Date())
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays))
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, '0')
  const d = shifted.getUTCDate().toString().padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${m}-${d}`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor((minutes % 1440) / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export function formatPrice(value: number): string {
  return `${value.toLocaleString('sr-RS')} RSD`
}

export function cropImageUrl(url: string, width: number, height: number): string {
  return `${url}?tr=w-${width},h-${height},c-maintain_ratio,fo-center`
}

export function formatShortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return iso
  return `${match[3]}.${match[2]}.${match[1]}.`
}

export function relativeTimeAgo(iso: string): string {
  const hasOffset = /[+-]\d\d:\d\d$/.test(iso)
  let postedMs: number
  if (hasOffset) {
    postedMs = new Date(iso).getTime()
  } else {
    const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
    if (!m) return ''
    const [, y, mo, d, h, mi, s = '0'] = m
    postedMs = belgradeWallToUtcMs(+y, +mo, +d, +h, +mi, +s)
  }
  const diffMin = Math.floor((Date.now() - postedMs) / 60000)
  if (diffMin < 1) return 'Upravo'
  if (diffMin < 60) return `pre ${diffMin} min`
  return `pre ${Math.floor(diffMin / 60)} h`
}