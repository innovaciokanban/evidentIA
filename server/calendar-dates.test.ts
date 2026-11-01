import { describe, expect, it } from 'vitest'
import { calendarDateToUtc, isCalendarDate, isCalendarDateOverdue } from './calendar-dates.js'
import { actionItemCreateSchema, ticketCreateSchema } from './validation.js'

describe('calendar date handling', () => {
  it('accepts real YYYY-MM-DD dates and rejects impossible calendar dates', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2027-02-29')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(isCalendarDate('2026-10-30T00:00:00.000Z')).toBe(false)
  })

  it('stores a calendar date at UTC midnight without shifting its key', () => {
    expect(calendarDateToUtc('2026-10-30').toISOString()).toBe('2026-10-30T00:00:00.000Z')
    const parsed = ticketCreateSchema.safeParse({ title: 'Ticket válido', description: 'Descripción válida', dueDate: '2026-10-30' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.dueDate?.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    expect(ticketCreateSchema.safeParse({ title: 'Ticket válido', description: 'Descripción válida', dueDate: '2026-02-29' }).success).toBe(false)
    expect(actionItemCreateSchema.safeParse({ title: 'Actividad válida', description: 'Descripción válida', priority: 'HIGH', dueDate: '30/10/2026' }).success).toBe(false)
  })

  it('expires only after the calendar day ends in America/Bogota', () => {
    const dueDate = calendarDateToUtc('2026-10-30')
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-30T23:59:59.999Z'), 'America/Bogota')).toBe(false)
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-31T04:59:59.999Z'), 'America/Bogota')).toBe(false)
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-31T05:00:00.000Z'), 'America/Bogota')).toBe(true)
  })

  it('uses the requested IANA zone rather than the server timezone', () => {
    const dueDate = calendarDateToUtc('2026-10-30')
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-31T00:00:00.000Z'), 'UTC')).toBe(true)
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-30T14:59:59.999Z'), 'Asia/Tokyo')).toBe(false)
    expect(isCalendarDateOverdue(dueDate, new Date('2026-10-30T15:00:00.000Z'), 'Asia/Tokyo')).toBe(true)
  })

  it('handles the end of year without changing the stored date convention', () => {
    const dueDate = calendarDateToUtc('2026-12-31')
    expect(isCalendarDateOverdue(dueDate, new Date('2027-01-01T04:59:59.999Z'), 'America/Bogota')).toBe(false)
    expect(isCalendarDateOverdue(dueDate, new Date('2027-01-01T05:00:00.000Z'), 'America/Bogota')).toBe(true)
  })
})
