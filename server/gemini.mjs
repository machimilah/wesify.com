/**
 * The free tier that lets the interview be intelligent everywhere.
 *
 * Wesify's interview is only as good as the model behind it. With a key it behaves like a consultant who
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

/**
 * Ordered by what answers fastest, not by what is newest.
 *
 * Measured against a live free key, one interview turn each:
 *
 *   gemini-3.5-flash        2.7-4.0s   honours thinkingBudget 0
 *   gemini-3.1-flash-lite   1.0-3.4s   honours thinkingBudget 0
 *   gemini-3.6-flash        7-10s      rejects thinkingBudget, so it always thinks first
 *   gemini-3.7-flash        503 after 12s, then 503 after 39s, then 429
 *
 * The newest model was first, which is why an interview took ten seconds and sometimes far longer:
 * Wesify spent the operator's wait discovering that the most contended model on the free tier was busy,
 * before trying anything that would answer. Asked the same question, 3.5-flash and 3.1-flash-lite
 * returned the identical question text, so leading with a smaller model costs nothing that shows.
 *
 * Every name was checked against a real key. The 2.5 family, which reads like the safe conservative
 * fallback, is refused outright for keys issued now — so when this list needs updating, run the
 * models rather than reasoning about which ought to work.
 */
export const GEMINI_MODEL = process.env.BO_GEMINI_MODEL || 'gemini-3.5-flash'
const GEMINI_FALLBACK_MODELS = (process.env.BO_GEMINI_FALLBACK_MODELS ?? 'gemini-3.1-flash-lite,gemini-3.7-flash,gemini-3.6-flash,gemini-3-flash-preview')
  .split(',').map(name => name.trim()).filter(Boolean)

/**
 * Models that refuse `thinkingConfig`, remembered after the first refusal.
 *
 * They answer a flat "Request contains an invalid argument.", so Wesify learns it the only way available:
 * by being told once. Without this the same 400 is paid on every single call — a wasted round trip in
 * front of somebody waiting, on every question of every interview.
 */
const refusesThinkingConfig = new Set()

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
 * it meets a keyword outside it — `additionalProperties` and `maxLength` both being ones Wesify's schemas
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
    throw Object.assign(new Error(`The request was declined by safety review (${reason}). Wesify continued the interview with its built-in questions.`), { status: 422 })
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
 * The whole point is that none of these reach the operator as Wesify reverting to a fixed questionnaire.
 */
export async function runGeminiJson({ system, prompt, schema, maxTokens = 4000, thinkingBudget = 0, temperature = 0.4, timeoutMs = 12000, budgetMs = timeoutMs * 3 }) {
  if (!geminiAvailable()) throw Object.assign(new Error('Wesify is not configured for Gemini. Set GEMINI_API_KEY to enable it.'), { status: 503 })

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter(name => name !== GEMINI_MODEL)]
  const wireSchema = geminiSchema(schema)
  // Rebuilt per attempt rather than mutated, so a model already known to refuse thinkingConfig never
  // gets sent it a second time — the 400 that used to cost a round trip on every single question.
  const configFor = name => ({
    responseMimeType: 'application/json',
    responseSchema: wireSchema,
    maxOutputTokens: maxTokens,
    temperature,
    ...(refusesThinkingConfig.has(name) ? {} : { thinkingConfig: { thinkingBudget } }),
  })
  // Anything this process already knows to be gone or spent is skipped, rather than re-proved on
  // every question. If that leaves nothing, the whole list is tried again: better a slow turn than a
  // refusal based on a note Wesify wrote to itself an hour ago.
  const live = models.filter(isUsable)
  const queue = live.length ? live : [...models]
  let model = queue[0]
  let busyAttempts = 0
  let lastError = null
  /**
   * A budget for the whole cascade, not just for each model in it.
   *
   * The per-model deadline is there so one slow model does not hold up a question another one would
   * answer. It says nothing about how long the cascade itself may run, and five models at nine
   * seconds each is forty-five seconds of somebody watching a spinner — after which they were handed
   * the last model's complaint, which named a preview model they had never chosen and never asked
   * for. The wait was the failure; the message made it look like a broken model.
   *
   * So the deadline is the smaller of the model's own and what is left overall, and running out is
   * reported as what it is: nothing answered in time.
   */
  const startedAt = Date.now()
  const tried = []
  const spent = () => Date.now() - startedAt

  const moveOn = () => {
    const next = queue[queue.indexOf(model) + 1]
    if (!next) return false
    model = next
    busyAttempts = 0
    return true
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    /**
     * A deadline, because a busy model does not always say so quickly.
     *
     * One measured 503 took 12 seconds to arrive and another took 39, all of it spent in front of
     * somebody waiting for a question. Past the deadline Wesify stops listening and asks the next model,
     * which on the same key answers in about two seconds.
     */
    const remaining = budgetMs - spent()
    if (remaining <= 250) break
    if (!tried.includes(model)) tried.push(model)
    const deadline = AbortSignal.timeout(Math.min(timeoutMs, remaining))
    let response
    try {
      response = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() },
        signal: deadline,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: configFor(model),
        }),
      })
    } catch (error) {
      lastError = Object.assign(new Error(`${model} did not answer within ${Math.round(Math.min(timeoutMs, remaining) / 1000)}s.`), { status: 504 })
      parkModel(model, 60 * 1000)
      if (moveOn()) continue
      throw lastError
    }
    if (response.ok) return { text: textFrom(await response.json()), model }

    const detail = await response.text().catch(() => '')
    // The operator reads this on the build screen, so it carries Google's sentence rather than the
    // JSON envelope around it. A wall of braces reads as Wesify breaking; a sentence reads as a limit.
    const said = (() => { try { return String(JSON.parse(detail)?.error?.message ?? '').trim() } catch { return '' } })()
    lastError = Object.assign(new Error(`${model} declined the request (${response.status}). ${said || detail.slice(0, 200)}`), { status: response.status === 429 ? 429 : 502 })

    /**
     * Any 400 with `thinkingConfig` still attached is retried without it.
     *
     * This used to test the complaint for the word "thinking", which the models that actually reject
     * it do not say: `gemini-3.5-flash-lite` and `gemini-3.6-flash` answer a flat "Request contains an
     * invalid argument." So Wesify read a working model as broken, skipped it, and ran out of fallbacks
     * while three usable models sat in the list. The parameter is an optimisation; dropping it and
     * asking again costs one round trip and is right whatever the wording.
     */
    if (response.status === 400 && !refusesThinkingConfig.has(model)) {
      refusesThinkingConfig.add(model)
      continue
    }
    /**
     * A busy model is left, not waited for — while there is another one to ask.
     *
     * Wesify used to sleep 1.5s and try the same model again, twice, before moving on. On a free tier
     * where "currently experiencing high demand" is the normal answer from the newest model, that is
     * three seconds of sleep plus three slow round trips, all of it in front of somebody waiting for
     * a question that another model on the same key would have answered in two. Waiting is right
     * only when there is nothing else left to try.
     */
    if (BUSY.has(response.status)) {
      parkModel(model, 60 * 1000)
      if (moveOn()) continue
      if (busyAttempts < 2) {
        busyAttempts += 1
        await wait(busyAttempts * 1000)
        continue
      }
    }
    if (response.status === 404) {
      // Google names the replacement in the message — "use models/gemini-3.5-flash-lite" — so Wesify
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
      // does not clear today, so Wesify changes model rather than sitting in a wait it cannot win.
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

  /**
   * What the operator is told when the whole list is exhausted.
   *
   * `lastError` is whichever model happened to be last, which is the least capable one in the
   * cascade and the one they have least reason to have heard of. When more than one model was tried,
   * the honest sentence is that none of them answered — naming what was tried, and how long Wesify spent
   * before giving up.
   */
  if (tried.length > 1) {
    throw Object.assign(
      new Error(`No free model answered within ${Math.round(spent() / 1000)}s. Wesify tried ${tried.join(', ')}. ${lastError?.message ?? ''}`.trim()),
      { status: lastError?.status === 429 ? 429 : 504 },
    )
  }
  throw lastError ?? Object.assign(new Error('Gemini declined the request.'), { status: 502 })
}
