import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { DEFAULTS } from '../src/shared.js'

execFileSync(process.execPath, [new URL('../scripts/build.mjs', import.meta.url).pathname])
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const Switch = props => props
const Button = props => props
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useSyncExternalStore: (_subscribe, get) => get()
}
function load(windowExtras = {}) {
  let registration
  const windowObject = {
    ...windowExtras,
    __ModuleLoader__: {
      load: value => {
        registration = value
      }
    }
  }
  runInNewContext(bundle, { window: windowObject, AbortController, console })
  const requests = []
  const api = registration.factory(id => {
    requests.push(id)
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Switch, Button }
    throw new Error(`Unexpected external: ${id}`)
  })
  return { api, registration, requests }
}
function fixture({ permission = 'default', fetcher } = {}) {
  const sources = []
  const notifications = []
  const calls = []
  const opened = []
  const events = new Map()
  let focused = 0
  class Source {
    constructor(url) {
      this.url = url
      this.events = new Map()
      sources.push(this)
    }
    addEventListener(name, callback) {
      this.events.set(name, callback)
    }
    emit(name, data) {
      this.events.get(name)?.({ data: JSON.stringify(data) })
    }
    close() {
      this.closed = true
    }
  }
  class Notice {
    static permission = permission
    static async requestPermission() {
      Notice.permission = 'granted'
      return 'granted'
    }
    constructor(title, options) {
      this.title = title
      this.options = options
      notifications.push(this)
    }
    close() {
      this.closed = true
    }
  }
  const windowObject = {
    focus() {
      focused++
    },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name)
  }
  let values = { ...DEFAULTS }
  let revision = 0
  const request = async (url, options) => {
    calls.push({ url, options })
    if (fetcher) return fetcher(url, options)
    if (options.body) {
      values = { ...values, ...JSON.parse(options.body) }
      revision++
    }
    return { ok: true, json: async () => ({ values, revision }) }
  }
  const { api } = load()
  const controller = api.createClient({ fetcher: request, EventSourceClass: Source, NotificationClass: Notice, windowObject, openSession: id => opened.push(id), t: key => key })
  return { controller, api, sources, notifications, calls, opened, events, Notice, focused: () => focused }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const notice = { id: 'notice-1', sessionId: 'session-target', kind: 'done', time: 1, title: 'Fix the login flow' }
const multiline = { ...notice, id: 'notice-2', title: 'First line\nSecond\tline' }
const untitled = { id: 'notice-3', sessionId: 'session-target', kind: 'error', time: 3 }

test('titles are flattened to one bounded line; absence falls back to the event label', async () => {
  const { sanitizeTitle, validateNotice } = await import('../src/shared.js')
  assert.equal(sanitizeTitle('A  long\ttitle\n'), 'A long title')
  assert.equal(sanitizeTitle('x'.repeat(200))?.length, 80)
  assert.equal(sanitizeTitle('   '), undefined)
  assert.equal(validateNotice(untitled).title, undefined)
  const f = fixture({ permission: 'granted' })
  await f.controller.refresh()
  f.sources[0].emit('notification', multiline)
  assert.equal(f.notifications.at(-1).title, 'First line Second line')
  f.sources[0].emit('notification', untitled)
  assert.equal(f.notifications.at(-1).title, 'DeepSeek Harness')
  assert.equal(f.notifications.at(-1).options.body.startsWith('🔴 '), true)
  f.controller.dispose()
})

test('built client registers a lazy factory using only supported baseline modules', () => {
  const { api, registration, requests } = load()
  assert.equal(registration.id, 'dsh-macos-notifications')
  assert.equal(typeof api.apply, 'function')
  assert.deepEqual(requests, ['react', '@deepseek-ai/dsh-client-ui-primitives'])
  assert.ok(!/^import /m.test(bundle))
})

test('six event switches and three native buttons use localized accessible labels', async () => {
  const f = fixture()
  await f.controller.refresh()
  const tree = f.api.NotificationsSection({ controller: f.controller, t: key => `translated:${key}` })
  const flatten = node => (node && typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : [])
  const nodes = flatten(tree)
  const switches = nodes.filter(node => node.type === Switch)
  assert.equal(switches.length, 6)
  assert.deepEqual(
    switches.map(node => node.props.checked),
    [true, true, true, false, true, false]
  )
  assert.ok(switches.every(node => node.props.label.startsWith('translated:')))
  assert.equal(nodes.filter(node => node.type === Button).length, 3)
  assert.equal(nodes.filter(node => node.type === 'button' || node.type === 'input').length, 0)
  f.controller.dispose()
})

test('configuration writes use same-origin JSON with the required marker', async () => {
  const f = fixture()
  await f.controller.refresh()
  await f.controller.save('turn-end', true)
  const call = f.calls.at(-1)
  assert.equal(call.url, '/dsh-macos-notifications/settings')
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.credentials, 'same-origin')
  assert.equal(call.options.headers['x-dsh-notifications'], '1')
  assert.equal(call.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(call.options.body), { 'turn-end': true })
  assert.equal(f.controller.getSnapshot().values['turn-end'], true)
  f.controller.dispose()
})

test('permission grant closes the old stream and reconnects with ready=1', async () => {
  const f = fixture()
  await f.controller.refresh()
  assert.match(f.sources[0].url, /ready=0$/)
  await f.controller.requestPermission()
  assert.equal(f.sources[0].closed, true)
  assert.match(f.sources[1].url, /ready=1$/)
  assert.equal(f.controller.getSnapshot().permission, 'granted')
  f.sources[0].emit('receiver', { active: true })
  assert.equal(f.controller.getSnapshot().active, false)
  f.sources[1].emit('receiver', { active: true })
  assert.equal(f.controller.getSnapshot().active, true)
  f.controller.dispose()
})

test('mock notification preserves session identity, title, and deduplicates delivery', async () => {
  const f = fixture({ permission: 'granted' })
  await f.controller.refresh()
  f.sources[0].emit('notification', notice)
  f.sources[0].emit('notification', notice)
  assert.equal(f.notifications.length, 1)
  assert.equal(f.notifications[0].title, 'Fix the login flow')
  assert.equal(f.notifications[0].options.body.startsWith('🟢 '), true)
  assert.ok(f.notifications[0].options.body.includes('done'))
  f.notifications[0].onclick()
  assert.deepEqual(f.opened, ['session-target'])
  assert.equal(f.focused(), 1)
  assert.equal(f.notifications[0].closed, true)
  f.controller.test()
  assert.equal(f.notifications.length, 2)
  f.notifications[1].onshow()
  assert.equal(f.controller.getSnapshot().status, 'testShown')
  f.controller.dispose()
  assert.equal(f.notifications[1].onclick, null)
  assert.equal(f.notifications[1].closed, true)
})

test('malformed stream values and failed writes retain the last valid configuration', async () => {
  const f = fixture()
  await f.controller.refresh()
  f.sources[0].emit('settings', { values: { ask: 'yes' }, revision: 1 })
  assert.equal(f.controller.getSnapshot().status, 'failure')
  assert.equal(f.controller.getSnapshot().values.ask, true)
  f.sources[0].emit('notification', { ...notice, sessionId: 'bad id' })
  assert.equal(f.notifications.length, 0)
  f.controller.dispose()
  const failed = fixture({ fetcher: async () => ({ ok: false }) })
  await failed.controller.refresh()
  assert.equal(failed.controller.getSnapshot().loaded, false)
  assert.equal(failed.controller.getSnapshot().busy, false)
  assert.equal(failed.controller.getSnapshot().status, 'failure')
  failed.controller.dispose()
})

test('failed saves retain displayed values and permit a later retry', async () => {
  let fail = false
  const f = fixture({
    fetcher: async (_url, options) => {
      if (options.method === 'POST' && fail) return { ok: false }
      return { ok: true, json: async () => ({ values: { ...DEFAULTS, ...(options.body ? JSON.parse(options.body) : {}) }, revision: options.body ? 1 : 0 }) }
    }
  })
  await f.controller.refresh()
  fail = true
  await f.controller.save('ask', false)
  assert.equal(f.controller.getSnapshot().values.ask, true)
  assert.equal(f.controller.getSnapshot().status, 'failure')
  assert.equal(f.controller.getSnapshot().busy, false)
  fail = false
  await f.controller.save('ask', false)
  assert.equal(f.controller.getSnapshot().values.ask, false)
  f.controller.dispose()
})

test('stream revisions reject stale values and reset when a restarted Host reconnects', async () => {
  const f = fixture()
  await f.controller.refresh()
  const source = f.sources[0]
  source.emit('settings', { values: { ...DEFAULTS, ask: false }, revision: 5 })
  source.emit('settings', { values: DEFAULTS, revision: 4 })
  assert.equal(f.controller.getSnapshot().values.ask, false)
  source.emit('error')
  assert.equal(f.controller.getSnapshot().connected, false)
  source.emit('open')
  source.emit('settings', { values: DEFAULTS, revision: 0 })
  assert.equal(f.controller.getSnapshot().connected, true)
  assert.equal(f.controller.getSnapshot().values.ask, true)
  f.controller.dispose()
})

test('disposal aborts HTTP and detaches focus and stream callbacks', async () => {
  let resolveResponse
  const f = fixture({
    fetcher: () =>
      new Promise(resolve => {
        resolveResponse = resolve
      })
  })
  f.controller.start()
  assert.ok(f.events.has('focus'))
  f.controller.dispose()
  assert.equal(f.calls[0].options.signal.aborted, true)
  assert.equal(f.sources[0].closed, true)
  assert.equal(f.events.size, 0)
  resolveResponse({ ok: true, json: async () => ({ values: DEFAULTS, revision: 0 }) })
  await settle()
  assert.equal(f.controller.getSnapshot().loaded, false)
})

test('plugin mounts settings.section with locale and navigates through uiWorkspace', async () => {
  const disposers = []
  let entry
  let catalog
  const sources = []
  const shown = []
  const opened = []
  class Source {
    constructor() {
      this.handlers = {}
      sources.push(this)
    }
    addEventListener(name, fn) {
      this.handlers[name] = fn
    }
    close() {}
  }
  class Notification {
    static permission = 'granted'
    constructor() {
      shown.push(this)
    }
    close() {}
  }
  const { api } = load({
    fetch: async () => ({ ok: true, json: async () => ({ values: DEFAULTS, revision: 0 }) }),
    EventSource: Source,
    Notification,
    focus() {},
    addEventListener() {},
    removeEventListener() {}
  })
  api.apply({
    effect(fn) {
      disposers.push(fn())
    },
    locale: {
      register(ns, values) {
        catalog = values
        return () => {}
      },
      bind: () => key => key
    },
    slots: {
      inject(name, fn) {
        assert.equal(name, 'settings.section')
        return fn()
      },
      register(spec, component) {
        entry = { spec, component }
        return () => {}
      }
    },
    uiWorkspace: { openSession: id => opened.push(id) }
  })
  await settle()
  assert.equal(entry.spec.locale, 'dsh-macos-notifications')
  assert.equal(entry.component, api.NotificationsSection)
  assert.equal(catalog.zh.ask, '审批等待')
  assert.equal(catalog.zh['turn-end'], '轮次完成')
  sources[0].handlers.notification({ data: JSON.stringify(notice) })
  shown[0].onclick()
  assert.deepEqual(opened, ['session-target'])
  for (const dispose of disposers.reverse()) dispose?.()
})
