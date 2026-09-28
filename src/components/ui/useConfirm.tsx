import { useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'primary'
}

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void }

/**
 * Un unico dialogo de confirmacion para toda la app. `askConfirm` se puede llamar desde cualquier
 * manejador asincrono (borrados, acciones) sin anadir estado ni props a cada componente, y devuelve
 * una promesa booleana, de modo que el codigo que reemplaza a `window.confirm` conserva su forma.
 */
let pending: PendingConfirm | null = null
const listeners = new Set<() => void>()

function notify() { for (const listener of [...listeners]) listener() }

function settle(confirmed: boolean) {
  const current = pending
  pending = null
  notify()
  current?.resolve(confirmed)
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Una confirmacion pendiente se cancela en vez de apilarse encima de otra.
    if (pending) pending.resolve(false)
    pending = { ...options, resolve }
    notify()
  })
}

export function ConfirmHost() {
  const [request, setRequest] = useState<PendingConfirm | null>(pending)
  useEffect(() => {
    const listener = () => setRequest(pending)
    listeners.add(listener)
    // El aviso puede haberse emitido entre el render y este efecto.
    if (pending !== request) setRequest(pending)
    return () => { listeners.delete(listener) }
  }, [request])
  if (!request) return null
  return <ConfirmDialog title={request.title} message={request.message} confirmLabel={request.confirmLabel} variant={request.variant} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
}
