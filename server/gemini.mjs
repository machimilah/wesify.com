/**
 * The free tier that lets the interview be intelligent everywhere.
 *
 * BO's interview is only as good as the model behind it. With a key it behaves like a consultant who
 * already knows the trade; without one it drops to a fixed question bank that asks a plumber what a
 * plumbing company sells, and asks it again after they have answered. That fallback is the product
 * most people actually saw, because the only way to leave it was a paid Anthropic key.
 *
 * Google's AI Studio tier is free, needs no card, and is enough to run an interview: a key from
 * https://aistudio.google.com/apikey in `GEMINI_API_KEY` and every operator gets the real thing.
 *
 * Deliberately hand-rolled over `fetch` rather than a fifth SDK. One endpoint, one shape, and the
 * schema sanitiser below is the only part that needs explaining.
 */

export const GEMINI_MODEL = process.env.BO_GEMINI_MODEL || 'gemini-3.7-flash'

/**
 * Other free models to try when the first one has no quota left.
 *
 * The free tier meters per model, not per key: the newest flash model runs out first because it is
 * the one everybody uses, while another on the same key still answers. Without this, the first 429 of
 * the day ends the intelligent interview — the failure this whole path exists to prevent.
 *
 * Every name here was checked against a real free key. The 2.5 family, which read like the safe
 * conservative fallback, is refused outright for keys issued now: "no longer available to new users".
 * A fallback list nobody has actually called is a list of names, not a fallback — so when this needs
 * updating, run the models through a live key rather than reasoning about which ought to work.
 */
const GEMINI_FALLBACK_MODELS = (process.env.BO_GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3-flash-preview')
  .split(',').map(name => name.trim()).filter(Boolean)

/**
 * What this process has learned about each model, so one turn's discovery is not re-paid by the next.
 *
 * Walking four dead models costs four round trips on every question, in front of someone waiting. A
 * 404 is permanent — the model is gone for this key — while a spent daily quota is worth re-checking
 * eventually, so it is parked rather than buried.
 */
const unusable = new Map()
const isUsable = model => (unusable.get(model) ?? 0) < Date.now()
const parkModel = (model, milliseconds) => unusable.set(model, milliseconds === Infinity ? Infinity : Date.now() + milliseconds)
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''

/**
 * Gemini's structured output accepts a subset of JSON Schema, and rejects the request outright when
 * it meets a keyword outside it — `additionalProperties` and `maxLength` both being ones BO's schemas
 * carry for the Anthropic path. Whitelisted rather than blacklisted: a keyword nobody thought about
 * costs a 400 on a call the operator is sitting and waiting for, and the limits these expressed are
 * enforced in the validators that parse the reply anyway.
 */
const ALLOWED_SCHEMA_KEYWORDS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'propertyOrdering', 'anyOf', 'minItems', 'maxItems'])

export function geminiSchema(value) {
  if (Array.isArray(value)) return value.map(geminiSchema)
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) continue
    // Under `properties` the keys are the company's field names, not schema keywords, so the
    // whitelist must not be applied to them — doing that deletes the entire schema one level down.
    if (key === 'properties') output[key] = Object.fromEntries(Object.entries(item).map(([name, child]) => [name, geminiSchema(child)]))
    else if (key === 'items' || key === 'anyOf') output[key] = geminiSchema(item)
    else output[key] = item
  }
  return output
}

function textFrom(payload) {
  const candidate = payload?.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  const text = parts.filter(part => typeof part.text === 'string').map(part => part.text).join('').trim()
  if (text) return text
  const reason = candidate?.finishReason ?? payload?.promptFeedback?.blockReason ?? 'unknown'
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || reason === 'BLOCKLIST') {
    throw Object.assign(new Error(`The request was declined by safety review (${reason}). BO continued the interview with its built-in questions.`), { status: 422 })
  }
  throw Object.assign(new Error(`The consultant returned no output (${reason}).`), { status: 502 })
}

/** A free shared tier is busy, and busy is not the same as broken. */
const BUSY = new Set([500, 503])
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * Google says how long to wait, and it is worth reading.
 *
 * A per-minute limit clears in seconds and is worth waiting out; a per-day one does not clear at all
 * today, and waiting for it is just a slower way to fail. The `RetryInfo` detail tells the two apart.
 */
function retryAfter(detail) {
  const seconds = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(detail)?.[1])
  return Number.isFinite(seconds) ? seconds : null
}

/**
 * One structured call, against whichever free model will take it.
 *
 * Three failures are handled, and they are genuinely different things:
 *
 * - `thinkingConfig` on a 400 is dropped the way the Anthropic path drops `effort`: an optimisation
 *   not every model generation implements, and one that does not still answers perfectly well.
 * - A 500 or 503 is waited out. This is a free shared tier and "currently experiencing high demand"
 *   is a normal Tuesday on it.
 * - A 429 moves to the next model. The free tier meters per model, so the newest flash — the one
 *   everybody is on — runs dry while an older one on the same key still answers. A short per-minute
 *   limit is waited out instead, because Google says which it is in `retryDelay`.
 *
 * The whole point is that none of these reach the operator as BO reverting to a fixed questionnaire.
 */
export async function runGeminiJson({ system, prompt, schema, maxTokens = 4000, thinkingBudget = 0, temperature = 0.4 }) {
  if (!geminiAvailable()) throw Object.assign(new Error('BO is not configured for Gemini. Set GEMINI_API_KEY to enable it.'), { status: 503 })

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(name => name !== GEMINI_MODEL)]
  let generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: geminiSchema(schema),
    maxOutputTokens: maxTokens,
    temperature,
    thinkingConfig: { thinkingBudget },
  }
  // Anything this process already knows to be gone or spent is skipped, rather than re-proved on
  // every question. If that leaves nothing, the whole list is tried again: better a slow turn than a
  // refusal based on a note BO wrote to itself an hour ago.
  const live = models.filter(isUsable)
  const queue = live.length ? live : [...models]
  let model = queue[0]
  let busyAttempts = 0
  let lastError = null

  const moveOn = () => {
    const next = queue[queue.indexOf(model) + 1]
    if (!next) return false
    model = next
    busyAttempts = 0
    return true
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    })
    if (response.ok) return { text: textFrom(await response.json()), model }

    const detail = await response.text().catch(() => '')
    // The operator reads this on the build screen, so it carries Google's sentence rather than the
    // JSON envelope around it. A wall of braces reads as BO breaking; a sentence reads as a limit.
    const said = (() => { try { return String(JSON.parse(detail)?.error?.message ?? '').trim() } catch { return '' } })()
    lastError = Object.assign(new Error(`${model} declined the request (${response.status}). ${said || detail.slice(0, 200)}`), { status: response.status === 429 ? 429 : 502 })

    /**
     * Any 400 with `thinkingConfig` still attached is retried without it.
     *
     * This used to test the complaint for the word "thinking", which the models that actually reject
     * it do not say: `gemini-3.5-flash-lite` and `gemini-3.6-flash` answer a flat "Request contains an
     * invalid argument." So BO read a working model as broken, skipped it, and ran out of fallbacks
     * while three usable models sat in the list. The parameter is an optimisation; dropping it and
     * asking again costs one round trip and is right whatever the wording.
     */
    if (response.status === 400 && generationConfig.thinkingConfig) {
      const { thinkingConfig, ...rest } = generationConfig
      generationConfig = rest
      continue
    }
    if (BUSY.has(response.status) && busyAttempts < 2) {
      busyAttempts += 1
      await wait(busyAttempts * 1500)
      continue
    }
    if (response.status === 404) {
      // Google names the replacement in the message — "use models/gemini-3.5-flash-lite" — so BO
      // follows it rather than waiting for someone to notice a deprecation and edit a list.
      parkModel(model, Infinity)
      const replacement = /models\/([a-z0-9.\-]+)/gi.exec(said.split('use ').pop() ?? '')?.[1]
      if (replacement && replacement !== model && isUsable(replacement)) {
        if (!queue.includes(replacement)) queue.splice(queue.indexOf(model) + 1, 0, replacement)
        model = replacement
        busyAttempts = 0
        continue
      }
      if (moveOn()) continue
    }
    if (response.status === 429) {
      // A per-minute limit clears while the operator is still reading the last question; a daily one
      // does not clear today, so BO changes model rather than sitting in a wait it cannot win.
      const seconds = retryAfter(detail)
      if (seconds !== null && seconds <= 8 && busyAttempts < 2) {
        busyAttempts += 1
        await wait(seconds * 1000 + 250)
        continue
      }
      parkModel(model, 15 * 60 * 1000)
      if (moveOn()) continue
    }
    throw lastError
  }

  throw lastError ?? Object.assign(new Error('Gemini declined the request.'), { status: 502 })
}
