import {readFile} from 'node:fs/promises'
const secret = Bun.env.OPENROUTER_API_KEY?.trim()
let checked = 0
for await (const path of new Bun.Glob('dist/**/*.{js,css,html,json,map,txt}').scan('.')) {
  const value = await readFile(path, 'utf8')
  if ((secret && secret.length > 12 && value.includes(secret)) || /sk-or-v1-[a-zA-Z0-9]{24,}/.test(value)) throw new Error('Credential found in public artifact: ' + path)
  checked++
}
if (!checked) throw new Error('No build artifacts were found.')
console.log('Secret scan passed: ' + checked + ' public text assets.')
