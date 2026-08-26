import { maxLogoDataUrlLength } from './workspaceSetup'

/**
 * A picked file, made small enough to keep.
 *
 * Logos arrive as whatever was on the desktop — a 4000px export, a photo of a sign — and this is
 * shown in a 40px square and sent with every page load. So it is drawn down to 256px and re-encoded
 * before anything stores it, at falling quality until it fits. An SVG is already small and scales
 * better than anything this could produce, so it is kept exactly as it was.
 *
 * Lives beside the rules rather than inside a screen: it was written for the onboarding dialog, and
 * the dialog is gone — the same question is asked inside the build now.
 */
export async function readLogoFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
  if (file.type === 'image/svg+xml') {
    if (dataUrl.length > maxLogoDataUrlLength) throw new Error('That SVG is too detailed to use as a logo. Export it as a PNG.')
    return dataUrl
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('That image could not be opened.'))
    element.src = dataUrl
  })
  const size = 256
  const scale = Math.min(1, size / Math.max(image.width || size, image.height || size))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((image.width || size) * scale))
  canvas.height = Math.max(1, Math.round((image.height || size) * scale))
  const context = canvas.getContext('2d')
  if (!context) return dataUrl.slice(0, maxLogoDataUrlLength)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.92, 0.8, 0.6, 0.45]) {
    const encoded = canvas.toDataURL('image/webp', quality)
    if (encoded.length <= maxLogoDataUrlLength) return encoded
  }
  throw new Error('That image is too heavy even resized. Try a simpler one.')
}
