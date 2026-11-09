/**
 * Format server timestamps as China Standard Time without Intl. Some WeChat
 * runtimes (notably HarmonyOS variants) ignore locale/timeZone options and
 * expose Date's English default string, including "GMT+0800 (CST)".
 */
export function formatChinaClock(value: string | null | undefined): string {
  if (!value) return '--:--'

  // A plain clock value is already a wall-clock time; do not apply a zone.
  const clock = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
  if (clock) return `${clock[1].padStart(2, '0')}:${clock[2]}`

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i)
  if (!iso) return '--:--'

  const hour = Number(iso[4])
  const minute = Number(iso[5])
  if (hour > 23 || minute > 59) return '--:--'

  // Datetimes without a zone are treated as China wall time. The API normally
  // returns ISO strings ending in Z; parsing those numerically avoids device TZ.
  if (!iso[6]) return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '--:--'
  const chinaDate = new Date(timestamp + 8 * 60 * 60 * 1000)
  return `${String(chinaDate.getUTCHours()).padStart(2, '0')}:${String(chinaDate.getUTCMinutes()).padStart(2, '0')}`
}

export function chinaClockMinutes(value: string | null | undefined): number | null {
  const clock = formatChinaClock(value)
  if (clock === '--:--') return null
  const [hour, minute] = clock.split(':').map(Number)
  return hour * 60 + minute
}
