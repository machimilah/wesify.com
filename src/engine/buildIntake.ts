import { readWorkspaceSetup, saveWorkspaceSetup, type WorkspaceSetup } from './workspaceSetup'

/**
 * The two things Wesify has to be told, asked inside the build rather than in front of it.
 *
 * They used to be a dialog: steps, a progress rail and a "Start building" button, standing between a
 * description somebody had just typed and the thing they typed it for. It asked for a name and a
 * logo before Wesify had said a single word back — paperwork in the way of the product, which is the
 * thing Wesify exists to abolish.
 *
 * So they are questions now, asked by the same assistant that asks everything else, answered in the
 * same box, and they read as the opening of the interview instead of a form in front of it. Only the
 * wording is scripted: a name and a logo cannot be inferred from a description, and a model inventing
 * a company's name is worse than asking for it.
 *
 * This module is the part with no screen in it — what has been asked, what came back, and what that
 * means for the workspace's setup — so the rules can be read, and tested, without a browser.
 */

export type IntakeStepId = 'name' | 'logo'
export type IntakeStage = IntakeStepId | 'done'

export interface IntakeTurn {
  id: string
  role: 'bo' | 'you'
  text: string
}

export interface BuildIntake {
  stage: IntakeStage
  turns: IntakeTurn[]
  setup: WorkspaceSetup
  /**
   * Whether the answers have been acted on — published, folded into the description.
   *
   * Separate from `stage` because reaching the last question and doing something about it are two
   * different moments, and only the second must never happen twice: a reload that published the
   * workspace's identity a second time would be this browser's fault, not the operator's.
   */
  settled?: boolean
}

/** Asked in this order, in these words. */
export const intakeQuestions: Record<IntakeStepId, string> = {
  name: 'How should we name this workspace?',
  logo: 'Should we add a logo now, or skip this step?',
}

const order: IntakeStepId[] = ['name', 'logo']

const intakeKey = (workspaceId: string) => `bo-workspace-intake:${workspaceId}`

const turn = (role: IntakeTurn['role'], text: string): IntakeTurn => ({ id: crypto.randomUUID(), role, text })

/**
 * Every way of saying no, because both questions can be answered with one.
 *
 * A name is the only answer Wesify cannot work out for itself, and even that it will infer from the
 * description rather than refuse to continue. Nobody should have to type a company logo to get past
 * a question about one.
 */
export function saysSkip(text: string) {
  return /^(no|nope|none|skip|skip it|not now|later|no thanks|no thank you|nah)\b[.!]*$/i.test(text.trim())
}

export function startingIntake(workspaceId: string): BuildIntake {
  return { stage: 'name', turns: [turn('bo', intakeQuestions.name)], setup: readWorkspaceSetup(workspaceId) }
}

/**
 * Where this build's intake got to, so a reload lands back in the conversation rather than at the
 * first question with the answers already given.
 */
export function readBuildIntake(workspaceId: string): BuildIntake {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(intakeKey(workspaceId)) ?? 'null')
    if (!stored || typeof stored !== 'object') return startingIntake(workspaceId)
    const value = stored as Partial<BuildIntake>
    const stage: IntakeStage = value.stage && ([...order, 'done'] as IntakeStage[]).includes(value.stage) ? value.stage : 'name'
    const turns = Array.isArray(value.turns)
      ? value.turns.filter((item): item is IntakeTurn => Boolean(item && typeof item.text === 'string' && (item.role === 'bo' || item.role === 'you')))
      : []
    return { stage, turns: turns.length ? turns : startingIntake(workspaceId).turns, setup: readWorkspaceSetup(workspaceId), settled: Boolean(value.settled) }
  } catch {
    return startingIntake(workspaceId)
  }
}

export function saveBuildIntake(workspaceId: string, intake: BuildIntake) {
  localStorage.setItem(intakeKey(workspaceId), JSON.stringify({ stage: intake.stage, turns: intake.turns, settled: Boolean(intake.settled) }))
  // The setup is kept where the rest of Wesify already looks for it, rather than only inside this record.
  saveWorkspaceSetup(workspaceId, intake.setup)
  return intake
}

export function forgetBuildIntake(workspaceId: string) {
  localStorage.removeItem(intakeKey(workspaceId))
}

/** The intake with the next question asked, or finished when there is nothing left to ask. */
function advanced(intake: BuildIntake, setup: WorkspaceSetup, reply: string): BuildIntake {
  const next = order[order.indexOf(intake.stage as IntakeStepId) + 1]
  const spoken = [...intake.turns, turn('you', reply)]
  return next
    ? { stage: next, turns: [...spoken, turn('bo', intakeQuestions[next])], setup }
    : { stage: 'done', turns: spoken, setup }
}

/**
 * One answer, applied.
 *
 * `problem` is what to say back when an answer cannot be used — typing where the logo question needs
 * a picked file. The intake does not move on in that case, because the question has not actually
 * been answered.
 */
export function answerIntake(intake: BuildIntake, text: string): { intake: BuildIntake; problem: string } {
  const answer = text.trim()
  if (!answer || intake.stage === 'done') return { intake, problem: '' }
  const skipping = saysSkip(answer)

  if (intake.stage === 'name') {
    return { intake: advanced(intake, { ...intake.setup, name: skipping ? '' : answer.slice(0, 120) }, answer), problem: '' }
  }

  // The only answer typing can give this question is no. A logo arrives through the button beside
  // it, and saying so is more use than accepting "yes" and moving on without one.
  if (skipping) return { intake: advanced(intake, intake.setup, answer), problem: '' }
  return { intake, problem: 'Pick the image with the button below, or say skip and Wesify will carry on without one.' }
}

/** A picked logo, which answers the question it was picked for. */
export function withLogo(intake: BuildIntake, logo: string, fileName: string): BuildIntake {
  if (intake.stage !== 'logo') return intake
  return advanced(intake, { ...intake.setup, logo }, fileName)
}
