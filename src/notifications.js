import { createDedupe, validateNotice } from './shared.js'

/** Colored status glyphs macOS renders in notification bodies. */
const DOTS = Object.freeze({ ask: '🟡', question: '🟡', done: '🟢', 'subagent-done': '🟢', 'turn-end': '🟢', error: '🔴' })

/** Hold renderer Notification objects until close, and release callbacks on disposal. */
export function createNotifier({ NotificationClass, windowObject, openSession, copy, onStatus = () => {} }) {
  const live = new Set()
  const dedupe = createDedupe()
  let disposed = false
  const permission = () => (typeof NotificationClass === 'function' ? NotificationClass.permission : 'unsupported')
  const show = (notice, test = false) => {
    if (disposed || permission() !== 'granted') {
      if (test) onStatus('unavailable')
      return false
    }
    let notification
    try {
      const heading = test ? copy('testTitle') : (notice.title ?? 'DeepSeek Harness')
      const body = test ? copy('testBody') : `${DOTS[notice.kind] ?? '🟡'} ${copy(notice.kind)} · ${copy('body')}`
      notification = new NotificationClass(heading, { body, tag: test ? `dsh-test-${Date.now()}` : `dsh-${notice.id}` })
    } catch (error) {
      onStatus('testFailed')
      return false
    }
    live.add(notification)
    // Bound retained callbacks even when the OS never delivers a close event.
    while (live.size > 64) {
      const oldest = live.values().next().value
      oldest.onclick = oldest.onclose = oldest.onerror = oldest.onshow = null
      oldest.close()
      live.delete(oldest)
    }
    notification.onclick = () => {
      // Focus must still run when navigation fails or the session no longer exists.
      try {
        if (notice?.sessionId) openSession(notice.sessionId)
      } finally {
        try {
          windowObject.focus()
        } finally {
          notification.close()
          live.delete(notification)
        }
      }
    }
    notification.onclose = () => live.delete(notification)
    notification.onerror = () => {
      live.delete(notification)
      onStatus('testFailed')
    }
    if (test) {
      notification.onshow = () => onStatus('testShown')
      onStatus('testSent')
    }
    return true
  }
  return {
    permission,
    async requestPermission() {
      if (disposed || typeof NotificationClass !== 'function') return 'unsupported'
      return NotificationClass.requestPermission()
    },
    receive(value) {
      const notice = validateNotice(value)
      if (!notice || permission() !== 'granted' || !dedupe.accept(notice.id)) return false
      return show(notice)
    },
    test() {
      return show(null, true)
    },
    dispose() {
      disposed = true
      for (const notification of live) {
        notification.onclick = notification.onclose = notification.onerror = notification.onshow = null
        notification.close()
      }
      live.clear()
      dedupe.clear()
    }
  }
}
