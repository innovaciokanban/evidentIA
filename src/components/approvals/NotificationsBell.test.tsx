import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NotificationsBell, notificationWhen } from './NotificationsBell'
import type { AppNotification } from '../../types'

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'cmnotification00000001',
  title: 'Riesgo MIS-R1 pendiente de tu revisión',
  body: '«Entrega tardía de información» está esperando tu aprobación.',
  link: 'approvals/cmapproval000000000001',
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('notificationWhen', () => {
  it('resume la antigüedad en minutos, horas y días', () => {
    expect(notificationWhen(new Date().toISOString())).toBe('Ahora')
    expect(notificationWhen(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('Hace 5 min')
    expect(notificationWhen(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('Hace 3 h')
    expect(notificationWhen(new Date(Date.now() - 26 * 3_600_000).toISOString())).toBe('Ayer')
    expect(notificationWhen(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe('Hace 3 días')
  })
})

describe('NotificationsBell', () => {
  it('anuncia las notificaciones sin leer con su contador', () => {
    const markup = renderToStaticMarkup(
      <NotificationsBell notifications={[notification()]} unread={3} onOpen={() => {}} onMarkAllRead={() => {}} />,
    )
    expect(markup).toContain('Notificaciones (3 sin leer)')
    expect(markup).toContain('notifications-count')
    expect(markup).toContain('>3<')
  })

  it('oculta el contador cuando no hay pendientes', () => {
    const markup = renderToStaticMarkup(
      <NotificationsBell notifications={[notification({ readAt: '2026-10-01T09:00:00.000Z' })]} unread={0} onOpen={() => {}} onMarkAllRead={() => {}} />,
    )
    expect(markup).toContain('aria-label="Notificaciones"')
    expect(markup).not.toContain('notifications-count')
  })
})
