import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { classifyEvent, DEFAULTS, validateSettings } from '../src/shared.js'
import { createStore } from '../src/store.js'
import { createBridge } from '../src/host.js'

test('completion requires a running turn with completed evidence', () => {
  const agent = { id: 'root', session: { header: {} } }
  let state = classifyEvent({}, 'agent/status', { agent, status: 'running' }).state
  state = classifyEvent(state, 'session/event', { session: { id: 'root', header: {} }, event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } }).state
  const result = classifyEvent(state, 'agent/status', { agent, status: 'idle' })
  assert.deepEqual(result.notices, [{ kind: 'done', sessionId: 'root', key: 'turn-1' }])
  assert.equal(classifyEvent(result.state, 'agent/status', { agent, status: 'idle' }).notices.length, 0)
  assert.equal(classifyEvent({ running: true, ended: { turn: 1, reason: { kind: 'error' } } }, 'agent/status', { agent, status: 'idle' }).notices.length, 0)
})

test('approval, questions, child completion and errors preserve identity', () => {
  const agent = { id: 'child' }
  assert.equal(classifyEvent({}, 'approval/request', { agent, callId: 'call' }).notices[0].sessionId, 'child')
  assert.equal(classifyEvent({}, 'user-questions/request', { agent, wait: { callId: 'call' } }).notices[0].kind, 'question')
  assert.equal(classifyEvent({}, 'subagent/end', { id: 'child', runId: 'run', stopReason: 'completed' }).notices[0].kind, 'subagent-done')
  assert.equal(classifyEvent({}, 'agent/error', { agent, turn: 2 }).notices[0].kind, 'error')
  assert.equal(classifyEvent({}, 'approval/request', { agent, signal: { aborted: true } }).notices.length, 0)
  assert.throws(() => validateSettings({ ask: 'yes' }, true))
})

test('store serializes edits and persists private configuration', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-notify-test-')))
  const filename = join(directory, 'settings.json')
  const store = await createStore(filename)
  await Promise.all([store.update({ ask: false }), store.update({ question: false })])
  assert.equal(store.snapshot().revision, 2)
  const saved = JSON.parse(await readFile(filename, 'utf8'))
  assert.equal(saved.ask, false)
  assert.equal(saved.question, false)
  await store.close()
})

class Response extends EventEmitter {
  headersSent = false
  writableLength = 0
  chunks = []
  writeHead(status, headers) {
    this.status = status
    this.headers = headers
    this.headersSent = true
  }
  write(value) {
    this.chunks.push(value)
    return true
  }
  end(value) {
    if (value) this.chunks.push(value)
    this.writableEnded = true
    this.emit('close')
  }
  setHeader() {}
  destroy() {
    this.destroyed = true
    this.emit('close')
  }
}
test('host rejects unauthenticated routes and elects a single receiver', async () => {
  let denied = 401
  const ctx = { connection: { requestRejection: () => denied }, logger: { warn() {} } }
  const store = { snapshot: () => ({ values: { ...DEFAULTS }, revision: 0 }), close: async () => {} }
  const bridge = createBridge(ctx, store)
  try {
    const settings = bridge.routes[0].handler,
      events = bridge.routes[1].handler
    const rejected = new Response()
    await settings({ headers: {}, method: 'GET' }, rejected)
    assert.equal(rejected.status, 401)
    denied = undefined
    const first = new Response(),
      second = new Response()
    await events({ headers: {}, method: 'GET', url: '/events?ready=1' }, first)
    await events({ headers: {}, method: 'GET', url: '/events?ready=1' }, second)
    bridge.observe('approval/request', { agent: { id: 'session' }, callId: 'call' })
    assert.equal(first.chunks.filter(x => x.includes('event: notification')).length, 1)
    assert.equal(second.chunks.filter(x => x.includes('event: notification')).length, 0)
    first.end()
    bridge.observe('approval/request', { agent: { id: 'session' }, callId: 'other' })
    assert.equal(second.chunks.filter(x => x.includes('event: notification')).length, 1)
  } finally {
    await bridge.close()
  }
})
test('notification frames carry the resolved session title when the service exists', async () => {
  const agents = new Map([['session-live', { session: { id: 'session-live' } }]])
  const ctx = {
    connection: { requestRejection: () => undefined },
    logger: { warn() {} },
    get: name => {
      if (name === 'sessionTitle') return { get: session => ({ title: '  Multi\nline  title  ' }) }
      if (name === 'agents') return { get: id => agents.get(id) }
      return undefined
    }
  }
  const store = { snapshot: () => ({ values: { ...DEFAULTS }, revision: 0 }), close: async () => {} }
  const bridge = createBridge(ctx, store)
  try {
    const events = bridge.routes[1].handler
    const receiver = new Response()
    await events({ headers: {}, method: 'GET', url: '/events?ready=1' }, receiver)
    bridge.observe('approval/request', { agent: { id: 'session-live' }, callId: 'call' })
    const frame = receiver.chunks.find(x => x.includes('event: notification'))
    assert.ok(frame)
    assert.ok(frame.includes('"title":"Multi line title"'))
    // An unknown session resolves no title and the frame simply omits it.
    bridge.observe('approval/request', { agent: { id: 'session-unknown' }, callId: 'call2' })
    const plain = receiver.chunks.filter(x => x.includes('event: notification')).at(-1)
    assert.ok(!plain.includes('"title"'))
  } finally {
    await bridge.close()
  }
})
