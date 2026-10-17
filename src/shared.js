/** Fixed wire vocabulary shared by the Host and renderer. */
export const KINDS = Object.freeze(['ask', 'question', 'done', 'error', 'subagent-done', 'turn-end'])
export const DEFAULTS = Object.freeze({ ask: true, question: true, done: true, error: true, 'subagent-done': false, 'turn-end': false })
export const BASE_PATH = '/dsh-macos-notifications'
/** Notification titles stay one short single line. */
export const TITLE_MAX_CHARS = 80

/** Reject non-boolean persisted or HTTP values; unknown keys are dropped for forward compatibility. */
export function validateSettings(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected an object with boolean fields.')
  const result = {}
  for (const key of Object.keys(value)) {
    if (KINDS.includes(key) && typeof value[key] === 'boolean') result[key] = value[key]
  }
  if (!partial && KINDS.some(key => !Object.hasOwn(result, key))) throw new TypeError('All six event fields are required.')
  if (partial && Object.keys(result).length === 0) throw new TypeError('At least one event field is required.')
  return result
}

/** Sanitize one untrusted session title for display: single line and bounded. */
export function sanitizeTitle(value) {
  if (typeof value !== 'string') return undefined
  const line = value
    .replace(/[^\S\r\n]+/gu, ' ')
    .replace(/[\r\n\t\x00-\x1f\x7f]/gu, ' ')
    .replace(/ {2,}/gu, ' ')
    .trim()
  if (line.length === 0) return undefined
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1)}…` : line
}

/** IDs are opaque DSH strings, not URL destinations or filesystem paths. */
export function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\x00-\x1f\x7f]/u.test(value)
}

/** Parse a bounded notification received from the Host. */
export function validateNotice(value) {
  if (!value || typeof value !== 'object' || !KINDS.includes(value.kind) || !validId(value.id) || !validId(value.sessionId)) return null
  if (!Number.isSafeInteger(value.time) || value.time < 0) return null
  const title = sanitizeTitle(value.title)
  return { id: value.id, kind: value.kind, sessionId: value.sessionId, time: value.time, ...(title === undefined ? {} : { title }) }
}

/** A bounded recent-ID set prevents duplicate events without retaining sessions forever. */
export function createDedupe({ limit = 1024, ttlMs = 120000, now = Date.now } = {}) {
  const seen = new Map()
  return {
    accept(id) {
      const time = now()
      for (const [key, expires] of seen) if (expires <= time) seen.delete(key)
      if (seen.has(id)) return false
      seen.set(id, time + ttlMs)
      while (seen.size > limit) seen.delete(seen.keys().next().value)
      return true
    },
    clear() {
      seen.clear()
    },
    get size() {
      return seen.size
    }
  }
}

/** Pure state transition over observed DSH events. The caller owns the state map. */
export function classifyEvent(state, type, payload) {
  const notices = []
  const next = { ...state }
  const add = (kind, sessionId, key) => {
    if (validId(sessionId)) notices.push({ kind, sessionId, key })
  }
  switch (type) {
    case 'approval/request':
      if (!payload.signal?.aborted) add('ask', payload.agent?.id, payload.callId)
      break
    case 'user-questions/request':
      if (!payload.signal?.aborted) add('question', payload.agent?.id, payload.wait?.callId)
      break
    case 'agent/status':
      if (payload.status === 'running') {
        next.running = true
        next.ended = undefined
      }
      if (payload.status === 'idle' && state.running) {
        next.running = false
        if (state.ended?.reason.kind === 'completed' && payload.agent.session.header.origin !== 'subagent') {
          add('done', payload.agent.id, `turn-${state.ended.turn}`)
        }
      }
      break
    case 'session/event': {
      const { session, event } = payload
      if (event.type !== 'turn/end') break
      next.ended = event.data
      if (session.header.origin !== 'subagent' && event.data.reason.kind !== 'forked') {
        add('turn-end', session.id, `turn-${event.data.turn}`)
      }
      if (event.data.reason.kind === 'error') add('error', session.id, `turn-${event.data.turn}`)
      break
    }
    case 'agent/error':
      add('error', payload.agent.id, `turn-${payload.turn}`)
      break
    case 'agent-loop/config-start-failed':
      add('error', payload.sessionId, undefined)
      break
    case 'subagent/end':
      if (payload.stopReason === 'completed') add('subagent-done', payload.id, payload.runId)
      if (payload.stopReason === 'error') add('error', payload.id, payload.runId)
      break
    default:
      break
  }
  return { state: next, notices }
}

/** Localized copy contains no transcript, tool arguments, or error details. */
export const COPY = Object.freeze({
  en: {
    title: 'macOS notifications',
    description: 'Native notifications. Click a notification to open its session.',
    ask: 'Approval required',
    question: 'Question',
    done: 'Task completed',
    error: 'Error',
    'subagent-done': 'Subagent completed',
    'turn-end': 'Turn ended',
    permission: 'Permission',
    granted: 'Allowed',
    denied: 'Blocked in system or browser configuration',
    default: 'Not requested',
    unsupported: 'Not supported',
    request: 'Allow notifications',
    test: 'Send test notification',
    refresh: 'Refresh status',
    loading: 'Loading configuration',
    saving: 'Saving configuration',
    saved: 'Configuration saved',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    receiver: 'This window receives notifications',
    standby: 'Another window receives notifications',
    testSent: 'Test submitted. macOS can hide it during Focus mode.',
    testShown: 'The system accepted the test notification.',
    testFailed: 'The system rejected the test notification.',
    unavailable: 'Allow notifications before you send a test.',
    body: 'Click to open the related DeepSeek Harness session.',
    testTitle: 'DeepSeek Harness test',
    testBody: 'Native notifications are enabled. Click to focus DeepSeek Harness.',
    failure: 'The request failed. Refresh the status and try again.'
  },
  zh: {
    title: 'macOS 通知',
    description: '原生系统通知，点击通知返回对应会话。',
    ask: '审批请求',
    question: '提问',
    done: '任务完成',
    error: '错误',
    'subagent-done': '子代理完成',
    'turn-end': '回合结束',
    permission: '通知权限',
    granted: '已允许',
    denied: '已被系统或浏览器阻止',
    default: '尚未请求',
    unsupported: '当前环境不支持',
    request: '允许通知',
    test: '发送测试通知',
    refresh: '刷新状态',
    loading: '正在读取配置',
    saving: '正在保存配置',
    saved: '配置已保存',
    connected: '已连接',
    reconnecting: '正在重新连接',
    receiver: '当前窗口接收通知',
    standby: '其他窗口正在接收通知',
    testSent: '测试已提交，macOS 专注模式可能隐藏通知。',
    testShown: '系统已接受测试通知。',
    testFailed: '系统未能显示测试通知。',
    unavailable: '请先允许通知，再发送测试。',
    body: '点击打开对应的 DeepSeek Harness 会话。',
    testTitle: 'DeepSeek Harness 测试',
    testBody: '原生通知已启用。点击返回 DeepSeek Harness。',
    failure: '请求失败，请刷新状态后重试。'
  }
})

/** Resolve one locale without importing a different plugin implementation. */
export function copyFor(language) {
  return COPY[String(language).startsWith('zh') ? 'zh' : 'en']
}
