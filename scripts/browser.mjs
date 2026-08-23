import { access } from 'node:fs/promises'
import { chromium } from 'playwright-core'

/**
 * Finds a browser the browser-driven tests can drive.
 *
 * `playwright-core` deliberately ships no browser of its own, which is why every one of these tests
 * named an executable path. Each one named the same hardcoded Windows Edge path, which worked exactly
 * as long as the suite only ever ran on this machine. CI runs on Linux and would have failed all six
 * of them on the first line, so the path became configuration instead: `BO_BROWSER` if set, otherwise
 * the first of the usual installs that actually exists on this platform.
 */

const candidates = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/root/.cache/ms-playwright/chromium/chrome-linux/chrome',
  ],
}

export async function browserPath() {
  if (process.env.BO_BROWSER) return process.env.BO_BROWSER
  for (const candidate of candidates[process.platform] ?? []) {
    try { await access(candidate); return candidate } catch {}
  }
  throw new Error(`No Chromium-based browser found for ${process.platform}. Install Chrome or Edge, or set BO_BROWSER to its executable.`)
}

/** Every browser test opens the browser the same way; only the path was ever in question. */
export async function launchBrowser(options = {}) {
  return chromium.launch({ executablePath: await browserPath(), headless: true, ...options })
}
