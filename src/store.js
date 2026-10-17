import { constants } from 'node:fs'
import { mkdir, open, lstat, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULTS, validateSettings } from './shared.js'

/** Single-runtime configuration store with serialized, atomic, private writes. */
export async function createStore(filename) {
  const file = resolve(filename)
  const directory = dirname(file)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory) throw new Error('Configuration directory must not contain symbolic links.')
  let values = { ...DEFAULTS }
  let revision = 0
  let tail = Promise.resolve()
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if ((await handle.stat()).size > 4096) throw new Error('Configuration file exceeds 4096 bytes.')
      values = validateSettings(JSON.parse(await handle.readFile('utf8')))
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const snapshot = () => ({ values: { ...values }, revision })
  return {
    snapshot,
    update(patch) {
      const valid = validateSettings(patch, true)
      const operation = tail.then(async () => {
        const replacement = { ...values, ...valid }
        const temporary = join(directory, `.settings-${randomUUID()}.tmp`)
        let created = false
        try {
          const handle = await open(temporary, 'wx', 0o600)
          created = true
          try {
            await handle.writeFile(`${JSON.stringify(replacement, null, 2)}\n`)
            await handle.sync()
          } finally {
            await handle.close()
          }
          // Both paths resolve to this store's previously inspected private directory.
          if (dirname(file) !== directory || dirname(temporary) !== directory) throw new Error('Configuration path escaped its directory.')
          await rename(temporary, file)
          created = false
          values = replacement
          revision += 1
          return snapshot()
        } finally {
          if (created) await unlink(temporary)
        }
      })
      tail = operation.catch(() => {}) // A failed save must not block the next explicit save.
      return operation
    },
    async close() {
      await tail
    }
  }
}
