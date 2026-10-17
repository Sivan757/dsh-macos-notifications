import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BASE_PATH, classifyEvent, createDedupe, sanitizeTitle, validId, validateSettings } from './shared.js'
import { createStore } from './store.js'

export const name = 'dsh-macos-notifications'
export const inject = ['webServer', 'connection']

/** Resolve the optional session-title service without a hard dependency. */
function titleOf(ctx, sessionId) {
  const titleService = ctx.get?.('sessionTitle')
  const agent = ctx.get?.('agents')?.get?.(sessionId)
  if (titleService === undefined || agent?.session === undefined) return undefined
  try {
    const snapshot = titleService.get(agent.session)
    const title = typeof snapshot?.title === 'string' ? snapshot.title : snapshot
    return sanitizeTitle(title)
  } catch {
    return undefined
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(value))
}

/** Buffer only a small, authenticated JSON request. */
export async function readPatch(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '') || req.headers['x-dsh-notifications'] !== '1') {
    throw Object.assign(new Error('Expected the same-origin JSON client.'), { status: 415 })
  }
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 4096) throw Object.assign(new Error('Request exceeds 4096 bytes.'), { status: 413 })
    chunks.push(chunk)
  }
  return validateSettings(JSON.parse(Buffer.concat(chunks).toString('utf8')), true)
}

/** Own all custom routes, event listeners, streams, and state for one plugin lifetime. */
export function createBridge(ctx, store) {
  const clients = new Set()
  const states = new Map()
  const dedupe = createDedupe()
  const requestIds = new WeakMap()
  const lifetime = randomUUID()
  let closed = false
  let ordinal = 0
  let owner
  const write = (client, event, data) => {
    if (client.res.destroyed || client.res.writableEnded) return false
    if (client.res.writableLength > 65536) {
      client.res.destroy()
      return false
    }
    return client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const elect = () => {
    owner = [...clients].find(client => client.ready)
    for (const client of clients) write(client, 'receiver', { active: client === owner })
  }
  const broadcastSettings = () => {
    for (const client of clients) write(client, 'settings', store.snapshot())
  }
  const observe = (type, payload) => {
    if (closed) return
    const id = payload.agent?.id ?? payload.session?.id ?? payload.id ?? payload.sessionId
    const result = classifyEvent(states.get(id) ?? {}, type, payload)
    if (type === 'agent/status' || type === 'session/event') {
      states.set(id, result.state)
      while (states.size > 4096) states.delete(states.keys().next().value)
    }
    for (const notice of result.notices) {
      if (!store.snapshot().values[notice.kind]) continue
      if (!notice.key) {
        if (!requestIds.has(payload)) requestIds.set(payload, randomUUID())
        notice.key = requestIds.get(payload)
      }
      const key = `${notice.kind}:${notice.sessionId}:${notice.key}`
      if (!dedupe.accept(key)) continue
      const title = titleOf(ctx, notice.sessionId)
      if (owner)
        write(owner, 'notification', {
          id: `${lifetime}:${++ordinal}`,
          kind: notice.kind,
          sessionId: notice.sessionId,
          time: Date.now(),
          ...(title === undefined ? {} : { title })
        })
    }
  }
  // Notification failure never claims an approval or interrupts the agent loop.
  const safeObserve = (type, payload) => {
    try {
      observe(type, payload)
    } catch (error) {
      ctx.logger.warn('Notification event failed: %s', error.message)
    }
  }
  const guarded = handler => async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return json(res, rejection, { error: 'Authentication or origin rejected.' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site requests are not accepted.' })
    if (closed) return json(res, 503, { error: 'Plugin is stopping.' })
    try {
      await handler(req, res)
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status ?? (error instanceof TypeError || error instanceof SyntaxError ? 400 : 500), {
          error: error.status || error instanceof TypeError || error instanceof SyntaxError ? error.message : 'Configuration could not be saved.'
        })
      else res.destroy()
    }
  }
  const routes = [
    {
      kind: 'exact',
      path: `${BASE_PATH}/settings`,
      handler: guarded(async (req, res) => {
        if (req.method === 'GET') return json(res, 200, store.snapshot())
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'GET, POST')
          return json(res, 405, { error: 'Method not allowed.' })
        }
        const snapshot = await store.update(await readPatch(req))
        broadcastSettings()
        json(res, 200, snapshot)
      })
    },
    {
      kind: 'exact',
      path: `${BASE_PATH}/events`,
      handler: guarded(async (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          return json(res, 405, { error: 'Method not allowed.' })
        }
        if (clients.size >= 16) return json(res, 429, { error: 'Too many notification windows.' })
        const url = new URL(req.url, 'http://localhost')
        const client = { res, ready: url.searchParams.get('ready') === '1' }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
        res.write('retry: 3000\n\n')
        clients.add(client)
        write(client, 'settings', store.snapshot())
        elect()
        res.once('close', () => {
          clients.delete(client)
          elect()
        })
      })
    }
  ]
  const timer = setInterval(() => {
    for (const client of clients) {
      if (client.res.destroyed || client.res.writableEnded) clients.delete(client)
      else if (client.res.writableLength > 65536) client.res.destroy()
      else client.res.write(': heartbeat\n\n')
    }
  }, 20000)
  timer.unref?.()
  return {
    routes,
    observe: safeObserve,
    forget(id) {
      states.delete(id)
    },
    async close() {
      closed = true
      clearInterval(timer)
      for (const client of clients) client.res.end()
      clients.clear()
      states.clear()
      dedupe.clear()
      await store.close()
    }
  }
}

/** Activate only through a DSH profile. No standalone server or external delivery channel. */
export async function apply(ctx) {
  const home = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const store = await createStore(join(home, 'macos-notifications', 'settings.json'))
  const bridge = createBridge(ctx, store)
  ctx.effect(() => () => bridge.close())
  for (const route of bridge.routes) ctx.effect(() => ctx.webServer.register(route))
  for (const event of ['approval/request', 'user-questions/request']) {
    ctx.on(
      event,
      (payload, next) => {
        bridge.observe(event, payload)
        return next()
      },
      { global: true, prepend: true }
    )
  }
  for (const event of ['agent/status', 'agent/error', 'subagent/end', 'agent-loop/config-start-failed']) {
    ctx.on(event, payload => bridge.observe(event, payload), { global: true })
  }
  ctx.on('session/event', (session, event) => bridge.observe('session/event', { session, event }), { global: true })
  ctx.on('agent/disposed', ({ agent }) => bridge.forget(agent.id), { global: true })
}
