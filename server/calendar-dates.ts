/**
 * Dates entered by users are calendar dates, not instants. The database keeps the existing
 * representation (UTC midnight for YYYY-MM-DD); only overdue calculations use the business zone.
 */
export const BUSINESS_TIME_ZONE = 'America/Bogota'

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/

export const isCalendarDate = (value: string): boolean => {
  if (!dateOnlyPattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
}

export const calendarDateToUtc = (value: string): Date => {
  if (!isCalendarDate(value)) throw new Error(`Invalid calendar date: ${value}`)
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** Extracts the stored calendar day without depending on the server's local timezone. */
export const storedCalendarDate = (value: Date): string => value.toISOString().slice(0, 10)

const zonedParts = (value: Date, timeZone: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(value)
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

export const calendarDateInTimeZone = (value: Date, timeZone = BUSINESS_TIME_ZONE): string => {
  const parts = zonedParts(value, timeZone)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

const nextCalendarDate = (value: string): string => new Date(calendarDateToUtc(value).getTime() + 86_400_000).toISOString().slice(0, 10)

/** Converts a local wall-clock midnight in an IANA zone to its UTC instant. */
const zonedMidnight = (date: string, timeZone: string): Date => {
  const [year, month, day] = date.split('-').map(Number)
  const targetAsUtc = Date.UTC(year, month - 1, day)
  let guess = targetAsUtc
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone)
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    guess = targetAsUtc - (displayedAsUtc - guess)
  }
  return new Date(guess)
}

/** A due date expires at the start of the following calendar day in the business zone. */
export const isCalendarDateOverdue = (dueDate: Date, now: Date, timeZone = BUSINESS_TIME_ZONE): boolean => {
  const dueDay = storedCalendarDate(dueDate)
  return now.getTime() >= zonedMidnight(nextCalendarDate(dueDay), timeZone).getTime()
}

/** UTC-midnight representation of the current business calendar day for SQL date comparisons. */
export const businessDayStart = (now: Date, timeZone = BUSINESS_TIME_ZONE): Date => calendarDateToUtc(calendarDateInTimeZone(now, timeZone))
