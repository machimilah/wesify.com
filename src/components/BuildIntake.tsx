import { ImagePlus, SkipForward } from 'lucide-react'
import { useRef, useState } from 'react'
import { readLogoFile } from '../engine/logoFile'
import { logoRejection } from '../engine/workspaceSetup'
import type { BuildIntake as Intake } from '../engine/buildIntake'

/**
 * The controls the three opening questions need, under the question being asked.
 *
 * Two of the three can be answered by typing, and are: a name is a name, and an address is an
 * address. A logo cannot be typed, so the question about it carries the file picker with it — beside
 * the answer box rather than in a dialog of its own, so it reads as part of the reply.
 *
 * All three carry Skip. None of them is required, and a person who came to watch their company
 * become software should never be held at a question about a logo.
 */
export function BuildIntakeControls({ intake, onLogo, onSkip, onProblem }: {
  intake: Intake
  onLogo: (logo: string, fileName: string) => void
  onSkip: () => void
  onProblem: (problem: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)

  // Every question carries the way past it, the first one included: a name Wesify has not been given is
  // one it infers from the description, which is a better outcome than a required field.
  if (intake.stage === 'done') return null

  const pick = async (file: File | undefined) => {
    if (!file) return
    const refusal = logoRejection(file)
    if (refusal) return onProblem(refusal)
    setReading(true)
    try {
      onLogo(await readLogoFile(file), file.name)
      onProblem('')
    } catch (error) {
      onProblem(error instanceof Error ? error.message : 'That image could not be used.')
    } finally {
      setReading(false)
    }
  }

  return <div className="bo-intake-actions" data-testid="intake-actions">
    {intake.stage === 'logo' && <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={event => { void pick(event.target.files?.[0]); event.target.value = '' }}
        data-testid="intake-logo-file"
      />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={reading} data-testid="intake-logo-pick">
        <ImagePlus size={14}/> {reading ? 'Reading…' : 'Add a logo'}
      </button>
    </>}
    <button type="button" className="bo-intake-skip" onClick={onSkip} data-testid="intake-skip">
      <SkipForward size={14}/> Skip
    </button>
  </div>
}
