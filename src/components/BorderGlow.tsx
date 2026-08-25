import { useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes, type PointerEvent } from 'react'
import './BorderGlow.css'

/*
 * Adapted from React Bits BorderGlow by David Haz.
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0.
 * Source and full license: https://github.com/DavidHDev/react-bits
 */

export interface BorderGlowProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  edgeSensitivity?: number
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  animated?: boolean
  colors?: string[]
  fillOpacity?: number
}

function parseHsl(value: string) {
  const match = value.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  return match
    ? { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) }
    : { h: 40, s: 80, l: 80 }
}

function buildGlowVariables(glowColor: string, intensity: number) {
  const { h, s, l } = parseHsl(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const suffixes = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  return Object.fromEntries(opacities.map((opacity, index) => [
    `--glow-color${suffixes[index]}`,
    `hsl(${base} / ${Math.min(opacity * intensity, 100)}%)`,
  ]))
}

const gradientPositions = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const gradientKeys = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven']
const colorMap = [0, 1, 2, 0, 1, 2, 1]

function buildGradientVariables(colors: string[]) {
  const palette = colors.length ? colors : ['#c084fc']
  const variables: Record<string, string> = {}
  gradientKeys.forEach((key, index) => {
    const color = palette[Math.min(colorMap[index], palette.length - 1)]
    variables[key] = `radial-gradient(at ${gradientPositions[index]}, ${color} 0px, transparent 50%)`
  })
  variables['--gradient-base'] = `linear-gradient(${palette[0]} 0 100%)`
  return variables
}

export default function BorderGlow({
  children,
  className = '',
  style,
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  colors = ['#c084fc', '#f472b6', '#38bdf8'],
  fillOpacity = 0.5,
  onPointerMove,
  ...elementProps
}: BorderGlowProps) {
  const cardRef = useRef<HTMLElement>(null)

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const deltaX = x - centerX
    const deltaY = y - centerY
    const scaleX = deltaX === 0 ? Infinity : centerX / Math.abs(deltaX)
    const scaleY = deltaY === 0 ? Infinity : centerY / Math.abs(deltaY)
    const proximity = Math.min(Math.max(1 / Math.min(scaleX, scaleY), 0), 1)
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 90
    if (angle < 0) angle += 360
    card.style.setProperty('--edge-proximity', `${(proximity * 100).toFixed(3)}`)
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`)
    onPointerMove?.(event)
  }, [onPointerMove])

  useEffect(() => {
    const card = cardRef.current
    if (!animated || !card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    card.classList.add('sweep-active')
    card.style.setProperty('--edge-proximity', '100')
    card.style.setProperty('--cursor-angle', '110deg')
    const timeout = window.setTimeout(() => {
      card.style.setProperty('--edge-proximity', '0')
      card.classList.remove('sweep-active')
    }, 1500)
    return () => window.clearTimeout(timeout)
  }, [animated])

  return <article
    {...elementProps}
    ref={cardRef}
    onPointerMove={handlePointerMove}
    className={`border-glow-card${className ? ` ${className}` : ''}`}
    style={{
      ...style,
      '--card-bg': backgroundColor,
      '--edge-sensitivity': edgeSensitivity,
      '--border-radius': `${borderRadius}px`,
      '--glow-padding': `${glowRadius}px`,
      '--cone-spread': coneSpread,
      '--fill-opacity': fillOpacity,
      ...buildGlowVariables(glowColor, glowIntensity),
      ...buildGradientVariables(colors),
    } as CSSProperties}
  >
    <span className="edge-light" />
    <div className="border-glow-inner">{children}</div>
  </article>
}
