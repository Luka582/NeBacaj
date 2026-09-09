const SERBIA_MIN_OFFSET = 120

function getSerbiaTime(): Date {
  const now = new Date()
  return new Date(now.getTime() + (now.getTimezoneOffset() + SERBIA_MIN_OFFSET) * 60000)
}

export function getSerbiaWeekday(): number {
  return getSerbiaTime().getDay()
}

export function getSerbiaMinutes(): number {
  const t = getSerbiaTime()
  return t.getHours() * 60 + t.getMinutes()
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
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
    const asUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
    postedMs = asUtcMs - SERBIA_MIN_OFFSET * 60000
  }
  const diffMin = Math.floor((Date.now() - postedMs) / 60000)
  if (diffMin < 1) return 'Upravo'
  if (diffMin < 60) return `pre ${diffMin} min`
  return `pre ${Math.floor(diffMin / 60)} h`
}