const shanghaiDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getShanghaiBusinessDate(date = new Date()): string {
  const parts = Object.fromEntries(
    shanghaiDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function getShanghaiBusinessMonth(date = new Date()): string {
  return getShanghaiBusinessDate(date).slice(0, 7)
}
