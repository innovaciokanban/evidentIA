/** Must stay aligned with the backend's explicit global business timezone. */
export const BUSINESS_TIME_ZONE = 'America/Bogota'

const dateParts = (value: string): [number, number, number] => value.slice(0, 10).split('-').map(Number) as [number, number, number]

export const calendarDate = (value: string): Date => {
  const [year, month, day] = dateParts(value)
  return new Date(Date.UTC(year, month - 1, day))
}

export const calendarDateKey = (value: string): string => value.slice(0, 10)

export const todayCalendarKey = (now = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export const calendarDayDifference = (value: string, now = new Date()): number => {
  const target = calendarDate(calendarDateKey(value)).getTime()
  const today = calendarDate(todayCalendarKey(now)).getTime()
  return Math.round((target - today) / 86_400_000)
}

export const isCalendarDateBeforeToday = (value: string, now = new Date()): boolean => calendarDateKey(value) < todayCalendarKey(now)

export const formatCalendarDate = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string =>
  new Intl.DateTimeFormat('es-CO', { ...options, timeZone: 'UTC' }).format(calendarDate(value))

export const calendarRelativeDate = (value: string, now = new Date()): string => {
  const days = calendarDayDifference(value, now)
  if (days === 0) return 'Hoy'
  if (days === -1) return 'Ayer'
  if (days === 1) return 'Mañana'
  if (days < 0 && days > -7) return `Hace ${Math.abs(days)} días`
  if (days > 1 && days < 7) return `En ${days} días`
  return formatCalendarDate(value, { day: 'numeric', month: 'short' })
}
