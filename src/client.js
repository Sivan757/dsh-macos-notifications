import { createElement as h, useSyncExternalStore } from 'react'
import { Switch, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { BASE_PATH, DEFAULTS, COPY, validateSettings } from './shared.js'
import { createNotifier } from './notifications.js'

export const name = 'dsh-macos-notifications'
export const inject = ['slots', 'locale', 'uiWorkspace']
const NS = 'dsh-macos-notifications'
const ORDER = ['ask', 'question', 'done', 'subagent-done', 'error', 'turn-end']
const dictionaries = {
  en: { ...COPY.en, ask: 'Approval waiting', question: 'Question for you', 'subagent-done': 'Subtask completed', error: 'Task error', 'turn-end': 'Turn completed' },
  zh: { ...COPY.zh, ask: '审批等待', question: '向你提问', 'subagent-done': '子任务完成', error: '任务出错', 'turn-end': '轮次完成' }
}

/** Own the HTTP requests, notification receiver, and browser permission lifecycle. */
export function createClient({ fetcher, EventSourceClass, NotificationClass, windowObject, openSession, t }) {
  const listeners = new Set()
  const abort = new AbortController()
  let disposed = false
  let source
  let revision = -1
  let generation = 0
  let state = { values: { ...DEFAULTS }, loaded: false, busy: false, permission: 'unsupported', connected: false, active: false, status: 'loading' }
  const publish = patch => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const notifier = createNotifier({ NotificationClass, windowObject, openSession, copy: t, onStatus: status => publish({ status }) })
  const accept = snapshot => {
    if (!Number.isSafeInteger(snapshot?.revision) || snapshot.revision < 0) throw new TypeError('Invalid configuration revision.')
    const values = validateSettings(snapshot.values)
    if (snapshot.revision < revision) return
    revision = snapshot.revision
    publish({ values, loaded: true })
  }
  const request = async patch => {
    const response = await fetcher(`${BASE_PATH}/settings`, {
      method: patch ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: abort.signal,
      headers: { 'Content-Type': 'application/json', 'x-dsh-notifications': '1' },
      ...(patch ? { body: JSON.stringify(validateSettings(patch, true)) } : {})
    })
    if (!response.ok) throw new Error('Configuration request failed.')
    accept(await response.json())
  }
  const connect = () => {
    if (disposed) return
    source?.close()
    const current = ++generation
    revision = -1
    publish({ permission: notifier.permission(), connected: false, active: false })
    if (typeof EventSourceClass !== 'function') {
      publish({ status: 'failure' })
      return
    }
    source = new EventSourceClass(`${BASE_PATH}/events?ready=${notifier.permission() === 'granted' ? '1' : '0'}`)
    const listen = (event, callback) =>
      source.addEventListener(event, payload => {
        if (disposed || current !== generation) return
        try {
          callback(payload)
        } catch (error) {
          publish({ status: 'failure' })
        }
      })
    listen('open', () => {
      revision = -1
      publish({ connected: true })
    })
    listen('error', () => publish({ connected: false, active: false }))
    listen('settings', payload => accept(JSON.parse(payload.data)))
    listen('receiver', payload => {
      const value = JSON.parse(payload.data)
      if (typeof value?.active !== 'boolean') throw new TypeError('Invalid receiver state.')
      publish({ active: value.active })
    })
    listen('notification', payload => notifier.receive(JSON.parse(payload.data)))
  }
  const refresh = async () => {
    if (disposed || state.busy) return
    publish({ busy: true, status: 'loading' })
    connect()
    try {
      await request()
      publish({ status: 'connected' })
    } catch (error) {
      publish({ status: 'failure' })
    } finally {
      publish({ busy: false })
    }
  }
  const onFocus = () => {
    if (notifier.permission() !== state.permission) connect()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      windowObject.addEventListener('focus', onFocus)
      void refresh()
    },
    refresh,
    async save(kind, value) {
      if (disposed || state.busy || !state.loaded) return
      publish({ busy: true, status: 'saving' })
      try {
        await request({ [kind]: value })
        publish({ status: 'saved' })
      } catch (error) {
        publish({ status: 'failure' })
      } finally {
        publish({ busy: false })
      }
    },
    async requestPermission() {
      if (disposed || state.busy) return
      publish({ busy: true })
      try {
        await notifier.requestPermission()
        connect()
      } catch (error) {
        publish({ status: 'failure' })
      } finally {
        publish({ busy: false })
      }
    },
    test() {
      notifier.test()
    },
    dispose() {
      disposed = true
      generation += 1
      abort.abort()
      source?.close()
      windowObject.removeEventListener('focus', onFocus)
      notifier.dispose()
      listeners.clear()
    }
  }
}

/** Render the six switches with the same native controls as built-in DSH pages. */
export function NotificationsSection({ controller, t }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }
  return h(
    'section',
    { 'aria-label': t('title'), style: { padding: 16 } },
    h('h3', null, t('title')),
    h('p', null, t('description')),
    ...ORDER.map(kind =>
      h(
        'div',
        { key: kind, style: rowStyle },
        h('span', null, t(kind)),
        h(Switch, { label: t(kind), checked: state.values[kind], disabled: !state.loaded || state.busy, onChange: value => void controller.save(kind, value) })
      )
    ),
    h('p', null, `${t('permission')}: ${t(state.permission)}`),
    h('p', null, t(state.connected ? (state.active ? 'receiver' : 'standby') : 'reconnecting')),
    h(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
      h(
        Button,
        { variant: 'primary', disabled: state.busy || state.permission === 'unsupported' || state.permission === 'granted', onClick: () => void controller.requestPermission() },
        t('request')
      ),
      h(Button, { variant: 'outline', disabled: state.busy || state.permission !== 'granted', onClick: () => controller.test() }, t('test')),
      h(Button, { variant: 'ghost', disabled: state.busy, onClick: () => void controller.refresh() }, t('refresh'))
    ),
    h('p', { role: 'status', 'aria-live': 'polite' }, t(state.status))
  )
}

/** Register a locale-owned settings section and one receiver per plugin lifetime. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, dictionaries))
  const t = ctx.locale.bind(NS)
  const controller = createClient({
    fetcher: window.fetch.bind(window),
    EventSourceClass: window.EventSource,
    NotificationClass: window.Notification,
    windowObject: window,
    openSession: id => ctx.uiWorkspace.openSession(id),
    t
  })
  ctx.effect(() => {
    controller.start()
    return () => controller.dispose()
  })
  ctx.effect(() =>
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: NS,
          order: 90,
          locale: NS,
          label: () => t('title'),
          inject: () => ({ controller })
        },
        NotificationsSection
      )
    )
  )
}
