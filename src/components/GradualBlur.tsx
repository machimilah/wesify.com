// Component added by Ansh - github.com/ansh-dhanani
import { memo, useMemo, type CSSProperties } from 'react'
import './GradualBlur.css'

export interface GradualBlurProps {
  position?: 'top' | 'bottom' | 'left' | 'right'
  strength?: number
  height?: string
  width?: string
  divCount?: number
  exponential?: boolean
  zIndex?: number
  opacity?: number
  curve?: 'linear' | 'bezier' | 'ease-in' | 'ease-out' | 'ease-in-out'
  target?: 'parent' | 'page'
  className?: string
  style?: CSSProperties
}

const curves: Record<NonNullable<GradualBlurProps['curve']>, (progress: number) => number> = {
  linear: progress => progress,
  bezier: progress => progress * progress * (3 - 2 * progress),
  'ease-in': progress => progress * progress,
  'ease-out': progress => 1 - Math.pow(1 - progress, 2),
  'ease-in-out': progress => progress < .5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2,
}

const directions: Record<NonNullable<GradualBlurProps['position']>, string> = {
  top: 'to top',
  bottom: 'to bottom',
  left: 'to left',
  right: 'to right',
}

function GradualBlur({
  position = 'bottom',
  strength = 2,
  height = '6rem',
  width,
  divCount = 5,
  exponential = false,
  zIndex = 1000,
  opacity = 1,
  curve = 'linear',
  target = 'parent',
  className = '',
  style,
}: GradualBlurProps) {
  const layerCount = Math.max(1, Math.round(divCount))
  const layers = useMemo(() => {
    const increment = 100 / layerCount
    const curveFunction = curves[curve]
    return Array.from({ length: layerCount }, (_, index) => {
      const step = index + 1
      const progress = curveFunction(step / layerCount)
      const blur = exponential
        ? Math.pow(2, progress * 4) * .0625 * strength
        : .0625 * (progress * layerCount + 1) * strength
      const first = Math.round((increment * step - increment) * 10) / 10
      const second = Math.round(increment * step * 10) / 10
      const third = Math.round((increment * step + increment) * 10) / 10
      const fourth = Math.round((increment * step + increment * 2) * 10) / 10
      let stops = `transparent ${first}%, black ${second}%`
      if (third <= 100) stops += `, black ${third}%`
      if (fourth <= 100) stops += `, transparent ${fourth}%`
      const mask = `linear-gradient(${directions[position]}, ${stops})`
      return <div key={step} style={{
        position: 'absolute',
        inset: 0,
        maskImage: mask,
        WebkitMaskImage: mask,
        backdropFilter: `blur(${blur.toFixed(3)}rem)`,
        WebkitBackdropFilter: `blur(${blur.toFixed(3)}rem)`,
        opacity,
      }} />
    })
  }, [curve, exponential, layerCount, opacity, position, strength])

  const vertical = position === 'top' || position === 'bottom'
  const containerStyle: CSSProperties = {
    position: target === 'page' ? 'fixed' : 'absolute',
    zIndex: target === 'page' ? zIndex + 100 : zIndex,
    pointerEvents: 'none',
    ...(vertical
      ? { height, width: width ?? '100%', [position]: 0, left: 0, right: 0 }
      : { width: width ?? height, height: '100%', [position]: 0, top: 0, bottom: 0 }),
    ...style,
  }

  return <div className={`gradual-blur gradual-blur-${target}${className ? ` ${className}` : ''}`} style={containerStyle} aria-hidden="true">
    <div className="gradual-blur-inner">{layers}</div>
  </div>
}

export default memo(GradualBlur)
