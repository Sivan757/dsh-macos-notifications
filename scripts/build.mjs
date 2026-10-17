import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await mkdir(resolve(root, 'lib'), { recursive: true })
for (const name of ['host', 'shared', 'store', 'notifications']) {
  await copyFile(resolve(root, `src/${name}.js`), resolve(root, `lib/${name}.js`))
}
// This closed module graph needs no installed compiler or third-party build scripts.
const modules = []
for (const name of ['shared', 'notifications', 'client']) {
  const exports = []
  let text = await readFile(resolve(root, `src/${name}.js`), 'utf8')
  // The trailing semicolon is optional: formatting must never decide whether the build parses.
  text = text.replace(/^import \{([^}]+)\} from '([^']+)';?$/gm, (_, names, specifier) => {
    const target = specifier.startsWith('./') ? `local(${JSON.stringify(specifier.slice(2, -3))})` : `require(${JSON.stringify(specifier)})`
    return `const {${names.replace(/\s+as\s+/g, ': ')}} = ${target};`
  })
  text = text.replace(/^export (const|function|async function) (\w+)/gm, (_, kind, id) => {
    exports.push(id)
    return `${kind} ${id}`
  })
  if (/^\s*(import|export)\s/m.test(text)) throw new Error(`Unsupported module syntax in src/${name}.js`)
  modules.push(`${JSON.stringify(name)}: () => {\n${text}\nreturn { ${exports.join(', ')} };\n}`)
}
const output = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},\n  factory: (require) => {\n    const cache = Object.create(null);\n    const modules = {\n${modules.join(',\n')}\n    };\n    const local = id => cache[id] ?? (cache[id] = modules[id]());\n    return local('client');\n  }\n});\n`
await writeFile(resolve(root, 'lib/client.js'), output)
console.log(`Built ${pkg.name}: Host ESM and registered Client factory.`)
