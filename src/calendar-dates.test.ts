import { describe, expect, it } from 'vitest'
import { calendarRelativeDate, formatCalendarDate, isCalendarDateBeforeToday } from './calendar-dates'

describe('frontend calendar date handling', () => {
  it('does not shift a stored UTC-midnight date in the UI', () => {
    expect(formatCalendarDate('2026-10-30T00:00:00.000Z')).toContain('30')
  })

  it('uses the business timezone for relative overdue labels', () => {
    const beforeMidnight = new Date('2026-10-31T04:59:59.999Z')
    const afterMidnight = new Date('2026-10-31T05:00:00.000Z')
    expect(isCalendarDateBeforeToday('2026-10-30', beforeMidnight)).toBe(false)
    expect(isCalendarDateBeforeToday('2026-10-30', afterMidnight)).toBe(true)
    expect(calendarRelativeDate('2026-10-31', beforeMidnight)).toBe('Mañana')
  })
})
