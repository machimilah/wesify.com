import { spawn } from 'node:child_process'

const api = spawn(process.execPath, ['server/index.mjs', '--port', '8787'], { cwd: process.cwd(), stdio: 'inherit' })
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { cwd: process.cwd(), stdio: 'inherit' })

function stop(code = 0) {
  api.kill(); vite.kill(); process.exit(code)
}

api.on('exit', code => { if (code) stop(code) })
vite.on('exit', code => stop(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
