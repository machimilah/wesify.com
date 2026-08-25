import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Writing a file so a reader never sees half of one.
 *
 * The pattern is the usual one — write a uniquely named candidate, then rename it over the target,
 * because rename is atomic and a truncated write is not. Five places in Wesify had their own copy of it.
 *
 * The retry is what the copies were missing. On Windows, renaming onto a file that another handle
 * has open fails outright with EPERM or EBUSY rather than waiting, and "another handle" includes a
 * concurrent reader, a virus scanner, and the search indexer. Two saves of the same discovery session
 * a few milliseconds apart were enough: the second one lost, the request came back a 500, and the
 * operator's answer was silently not recorded. It went unnoticed because it needs writes close enough
 * together to collide, which is exactly what happens once the interview gets faster.
 *
 * Retrying is correct rather than a papering-over: the failure is transient contention on the target,
 * the candidate is already written, and the rename is the only step left. What is never done is
 * falling back to a plain overwrite, which would trade a rare error for a rare truncated file.
 */

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

export async function writeFileAtomic(file, contents, { mode } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const candidate = `${file}.${randomUUID()}.next`
  // The mode is set on the candidate, before the rename, so the file is never briefly readable by
  // anyone else on the host: it arrives at its final name already restricted.
  await writeFile(candidate, contents, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(candidate, file)
      return
    } catch (error) {
      if (!TRANSIENT.has(error?.code) || attempt >= 5) throw error
      // Backs off a little each time: 10ms, 20ms, 40ms… A scanner holding the file is done in one of
      // those, and anything still holding it after six tries is a real problem worth reporting.
      await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}

/** The same, for the JSON every one of these files actually holds. */
export function writeJsonAtomic(file, value) {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}
