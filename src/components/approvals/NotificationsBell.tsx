import { useEffect, useRef, useState } from 'react'
import type { AppNotification } from '../../types'

/** Fecha relativa corta: "hace 2 h", "ayer", o la fecha completa si es más antigua. */
export function notificationWhen(value: string): string {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? 'Ayer' : `Hace ${days} días`
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

/**
 * Campana del topbar. El estado vive en Workspace (también alimenta el contador del menú lateral);
 * aquí solo se despliega la lista y se notifican las acciones: abrir una notificación la marca como
 * leída y navega a su destino ("approvals/<id>"), y "marcar todo" limpia el contador.
 */
export function NotificationsBell({ notifications, unread, onOpen, onMarkAllRead }: {
  notifications: AppNotification[]
  unread: number
  onOpen: (notification: AppNotification) => void
  onMarkAllRead: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="notifications" ref={rootRef}>
      <button type="button" className={`icon-button notifications-bell ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'} aria-expanded={open} aria-haspopup="true" title="Notificaciones">
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notifications-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notifications-panel" role="dialog" aria-label="Notificaciones">
          <div className="notifications-panel-head">
            <strong>Notificaciones</strong>
            <button type="button" className="text-button" disabled={unread === 0} onClick={() => { onMarkAllRead(); setOpen(false) }}>Marcar todas como leídas</button>
          </div>
          {notifications.length === 0 ? (
            <p className="notifications-empty">Sin notificaciones por ahora.</p>
          ) : (
            <ul className="notifications-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button type="button" className={`notification-item ${notification.readAt ? '' : 'is-unread'}`} onClick={() => { onOpen(notification); setOpen(false) }}>
                    <span className="notification-dot" aria-hidden="true" />
                    <span className="notification-body">
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                      <small>{notificationWhen(notification.createdAt)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
