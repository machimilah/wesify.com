import { beforeEach, describe, expect, it } from 'vitest'
import {
  answerIntake,
  intakeQuestions,
  readBuildIntake,
  readInvites,
  saveBuildIntake,
  saysSkip,
  startingIntake,
  withLogo,
  type BuildIntake,
} from './buildIntake'

/**
 * The three opening questions, without a browser.
 *
 * What matters here is not the wording but the rules underneath it: that a question nobody answered
 * properly is asked again rather than passed, that "no" gets past all three, and that the answers
 * survive a reload — a name typed once and asked for twice is the whole reason the dialog this
 * replaced was worth replacing.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      key: (index: number) => [...store.keys()][index] ?? null,
      clear: () => store.clear(),
      get length() { return store.size },
    },
  })
})

const answerAll = (workspaceId: string, replies: string[]) => {
  let intake = startingIntake(workspaceId)
  for (const reply of replies) intake = answerIntake(intake, reply).intake
  return intake
}

describe('the build intake', () => {
  it('opens by asking for a name', () => {
    const intake = startingIntake('ws-1')
    expect(intake.stage).toBe('name')
    expect(intake.turns.at(-1)?.text).toBe(intakeQuestions.name)
  })

  it('asks the three questions in order, keeping what it is told', () => {
    const named = answerIntake(startingIntake('ws-1'), 'Northwind Studio')
    expect(named.intake.setup.name).toBe('Northwind Studio')
    expect(named.intake.stage).toBe('logo')
    expect(named.intake.turns.at(-1)?.text).toBe(intakeQuestions.logo)

    const skippedLogo = answerIntake(named.intake, 'skip')
    expect(skippedLogo.intake.stage).toBe('team')
    expect(skippedLogo.intake.turns.at(-1)?.text).toBe(intakeQuestions.team)

    const invited = answerIntake(skippedLogo.intake, 'colleague@northwind.example')
    expect(invited.intake.stage).toBe('done')
    expect(invited.intake.setup.invites).toEqual([{ email: 'colleague@northwind.example', role: 'employee' }])
  })

  it('lets every question be skipped, and asks none of them twice', () => {
    const intake = answerAll('ws-1', ['no', 'skip', 'none'])
    expect(intake.stage).toBe('done')
    expect(intake.setup).toEqual({ name: '', logo: '', invites: [] })
    expect(intake.turns.filter(turn => turn.role === 'bo')).toHaveLength(3)
  })

  it('says so rather than moving on when a reply is not an address', () => {
    const asking = answerAll('ws-1', ['Northwind Studio', 'skip'])
    const refused = answerIntake(asking, 'not-an-address')
    expect(refused.problem).toContain('not an email address')
    expect(refused.intake.stage).toBe('team')
    expect(refused.intake.setup.invites).toEqual([])
  })

  it('answers the logo question with a file rather than with words', () => {
    const asking = answerAll('ws-1', ['Northwind Studio'])
    const typed = answerIntake(asking, 'yes please')
    expect(typed.problem).toContain('button')
    expect(typed.intake.stage).toBe('logo')

    const picked = withLogo(asking, 'data:image/webp;base64,AAA', 'mark.webp')
    expect(picked.setup.logo).toBe('data:image/webp;base64,AAA')
    expect(picked.stage).toBe('team')
    expect(picked.turns.at(-2)?.text).toBe('mark.webp')
  })

  it('reads several addresses out of one reply, and ignores a repeat', () => {
    const { invites, rejected } = readInvites('ana@example.com, bo@example.com; ana@example.com')
    expect(invites.map(invite => invite.email)).toEqual(['ana@example.com', 'bo@example.com'])
    expect(rejected).toEqual([])
  })

  it('comes back where it left off after a reload', () => {
    const asking = answerAll('ws-1', ['Northwind Studio'])
    saveBuildIntake('ws-1', asking)
    const resumed = readBuildIntake('ws-1')
    expect(resumed.stage).toBe('logo')
    expect(resumed.setup.name).toBe('Northwind Studio')
    expect(resumed.turns.map(turn => turn.text)).toEqual(asking.turns.map(turn => turn.text))
  })

  it('remembers that finished answers were already acted on', () => {
    const finished: BuildIntake = { ...answerAll('ws-1', ['no', 'no', 'no']), settled: true }
    saveBuildIntake('ws-1', finished)
    expect(readBuildIntake('ws-1').settled).toBe(true)
  })

  it('starts a fresh intake when the stored one is unreadable', () => {
    store.set('bo-workspace-intake:ws-1', '{oh dear')
    expect(readBuildIntake('ws-1').stage).toBe('name')
  })

  it('knows a refusal from an answer', () => {
    for (const no of ['no', 'No thanks', 'skip', 'none', 'not now', 'nah']) expect(saysSkip(no)).toBe(true)
    for (const yes of ['Northwind', 'no-frills.co', 'skipper@example.com']) expect(saysSkip(yes)).toBe(false)
  })
})
