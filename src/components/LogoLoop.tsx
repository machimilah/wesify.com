import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './LogoLoop.css'

/*
 * Adapted from React Bits LogoLoop by David Haz.
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0.
 * Source and full license: https://github.com/DavidHDev/react-bits
 */

export type LogoItem =
  | { node: React.ReactNode; href?: string; title?: string; ariaLabel?: string }
  | { src: string; alt?: string; href?: string; title?: string; srcSet?: string; sizes?: string; width?: number; height?: number }

export interface LogoLoopProps {
  logos: LogoItem[]
  speed?: number
  direction?: 'left' | 'right' | 'up' | 'down'
  width?: number | string
  logoHeight?: number
  gap?: number
  pauseOnHover?: boolean
  hoverSpeed?: number
  fadeOut?: boolean
  fadeOutColor?: string
  scaleOnHover?: boolean
  renderItem?: (item: LogoItem, key: React.Key) => React.ReactNode
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}

const ANIMATION_CONFIG = { SMOOTH_TAU: 0.25, MIN_COPIES: 2, COPY_HEADROOM: 2 } as const
const toCssLength = (value?: number | string) => typeof value === 'number' ? `${value}px` : (value ?? undefined)

function useResizeObserver(callback: () => void, elements: Array<React.RefObject<Element | null>>, dependencies: React.DependencyList) {
  useEffect(() => {
    if (!window.ResizeObserver) {
      window.addEventListener('resize', callback)
      callback()
      return () => window.removeEventListener('resize', callback)
    }
    const observers = elements.map(ref => {
      if (!ref.current) return null
      const observer = new ResizeObserver(callback)
      observer.observe(ref.current)
      return observer
    })
    callback()
    return () => observers.forEach(observer => observer?.disconnect())
  }, dependencies)
}

function useImageLoader(sequenceRef: React.RefObject<HTMLUListElement | null>, onLoad: () => void, dependencies: React.DependencyList) {
  useEffect(() => {
    const images = sequenceRef.current?.querySelectorAll('img') ?? []
    if (images.length === 0) {
      onLoad()
      return
    }
    let remaining = images.length
    const handleLoad = () => {
      remaining -= 1
      if (remaining === 0) onLoad()
    }
    images.forEach(image => {
      if (image.complete) handleLoad()
      else {
        image.addEventListener('load', handleLoad, { once: true })
        image.addEventListener('error', handleLoad, { once: true })
      }
    })
    return () => images.forEach(image => {
      image.removeEventListener('load', handleLoad)
      image.removeEventListener('error', handleLoad)
    })
  }, dependencies)
}

function useAnimationLoop(
  trackRef: React.RefObject<HTMLDivElement | null>,
  targetVelocity: number,
  sequenceWidth: number,
  sequenceHeight: number,
  isHovered: boolean,
  hoverSpeed: number | undefined,
  isVertical: boolean,
  active: boolean,
) {
  const frameRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const velocityRef = useRef(0)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const sequenceSize = isVertical ? sequenceHeight : sequenceWidth
    if (sequenceSize > 0) {
      offsetRef.current = ((offsetRef.current % sequenceSize) + sequenceSize) % sequenceSize
      track.style.transform = isVertical
        ? `translate3d(0, ${-offsetRef.current}px, 0)`
        : `translate3d(${-offsetRef.current}px, 0, 0)`
    }

    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const animate = (timestamp: number) => {
      if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp
      const deltaTime = Math.max(0, timestamp - lastTimestampRef.current) / 1000
      lastTimestampRef.current = timestamp
      const target = isHovered && hoverSpeed !== undefined ? hoverSpeed : targetVelocity
      const easing = 1 - Math.exp(-deltaTime / ANIMATION_CONFIG.SMOOTH_TAU)
      velocityRef.current += (target - velocityRef.current) * easing
      if (sequenceSize > 0) {
        const next = offsetRef.current + velocityRef.current * deltaTime
        offsetRef.current = ((next % sequenceSize) + sequenceSize) % sequenceSize
        track.style.transform = isVertical
          ? `translate3d(0, ${-offsetRef.current}px, 0)`
          : `translate3d(${-offsetRef.current}px, 0, 0)`
      }
      if (Math.abs(target) < .001 && Math.abs(velocityRef.current) < .02) {
        velocityRef.current = 0
        frameRef.current = null
        return
      }
      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      lastTimestampRef.current = null
    }
  }, [targetVelocity, sequenceWidth, sequenceHeight, isHovered, hoverSpeed, isVertical, active])
}

function useAnimationActivity(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let inView = false
    const update = () => setActive(inView && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      update()
    })
    const handleVisibility = () => update()
    observer.observe(container)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [containerRef])
  return active
}

export const LogoLoop = React.memo<LogoLoopProps>(({
  logos,
  speed = 120,
  direction = 'left',
  width = '100%',
  logoHeight = 28,
  gap = 32,
  pauseOnHover,
  hoverSpeed,
  fadeOut = false,
  fadeOutColor,
  scaleOnHover = false,
  renderItem,
  ariaLabel = 'Partner logos',
  className,
  style,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const sequenceRef = useRef<HTMLUListElement>(null)
  const [sequenceWidth, setSequenceWidth] = useState(0)
  const [sequenceHeight, setSequenceHeight] = useState(0)
  const [copyCount, setCopyCount] = useState<number>(ANIMATION_CONFIG.MIN_COPIES)
  const [isHovered, setIsHovered] = useState(false)
  const animationActive = useAnimationActivity(containerRef)
  const effectiveHoverSpeed = useMemo(() => {
    if (hoverSpeed !== undefined) return hoverSpeed
    if (pauseOnHover === true) return 0
    if (pauseOnHover === false) return undefined
    return 0
  }, [hoverSpeed, pauseOnHover])
  const isVertical = direction === 'up' || direction === 'down'
  const targetVelocity = useMemo(() => {
    const directionMultiplier = isVertical ? (direction === 'up' ? 1 : -1) : (direction === 'left' ? 1 : -1)
    return Math.abs(speed) * directionMultiplier * (speed < 0 ? -1 : 1)
  }, [speed, direction, isVertical])

  const updateDimensions = useCallback(() => {
    const containerWidth = containerRef.current?.clientWidth ?? 0
    const sequenceRect = sequenceRef.current?.getBoundingClientRect()
    const measuredWidth = sequenceRect?.width ?? 0
    const measuredHeight = sequenceRect?.height ?? 0
    if (isVertical) {
      const parentHeight = containerRef.current?.parentElement?.clientHeight ?? 0
      if (containerRef.current && parentHeight > 0) containerRef.current.style.height = `${Math.ceil(parentHeight)}px`
      if (measuredHeight > 0) {
        setSequenceHeight(Math.ceil(measuredHeight))
        const viewport = containerRef.current?.clientHeight ?? parentHeight ?? measuredHeight
        setCopyCount(Math.max(ANIMATION_CONFIG.MIN_COPIES, Math.ceil(viewport / measuredHeight) + ANIMATION_CONFIG.COPY_HEADROOM))
      }
    } else if (measuredWidth > 0) {
      setSequenceWidth(Math.ceil(measuredWidth))
      setCopyCount(Math.max(ANIMATION_CONFIG.MIN_COPIES, Math.ceil(containerWidth / measuredWidth) + ANIMATION_CONFIG.COPY_HEADROOM))
    }
  }, [isVertical])

  useResizeObserver(updateDimensions, [containerRef, sequenceRef], [logos, gap, logoHeight, isVertical])
  useImageLoader(sequenceRef, updateDimensions, [logos, gap, logoHeight, isVertical])
  useAnimationLoop(trackRef, targetVelocity, sequenceWidth, sequenceHeight, isHovered, effectiveHoverSpeed, isVertical, animationActive)

  const variables = useMemo(() => ({
    '--logoloop-gap': `${gap}px`,
    '--logoloop-logoHeight': `${logoHeight}px`,
    ...(fadeOutColor ? { '--logoloop-fadeColor': fadeOutColor } : {}),
  }) as React.CSSProperties, [gap, logoHeight, fadeOutColor])
  const rootClassName = ['logoloop', isVertical ? 'logoloop--vertical' : 'logoloop--horizontal', fadeOut && 'logoloop--fade', scaleOnHover && 'logoloop--scale-hover', className].filter(Boolean).join(' ')

  const renderLogoItem = useCallback((item: LogoItem, key: React.Key) => {
    if (renderItem) return <li className="logoloop__item" key={key} role="listitem">{renderItem(item, key)}</li>
    const isNodeItem = 'node' in item
    const content = isNodeItem
      ? <span className="logoloop__node" aria-hidden={Boolean(item.href && !item.ariaLabel)}>{item.node}</span>
      : <img src={item.src} srcSet={item.srcSet} sizes={item.sizes} width={item.width} height={item.height} alt={item.alt ?? ''} title={item.title} loading="lazy" decoding="async" draggable={false}/>
    const label = isNodeItem ? (item.ariaLabel ?? item.title) : (item.alt ?? item.title)
    const itemContent = item.href
      ? <a className="logoloop__link" href={item.href} aria-label={label || 'logo link'} target="_blank" rel="noreferrer noopener">{content}</a>
      : content
    return <li className="logoloop__item" key={key} role="listitem">{itemContent}</li>
  }, [renderItem])

  const lists = useMemo(() => Array.from({ length: copyCount }, (_, copyIndex) => (
    <ul className="logoloop__list" key={`copy-${copyIndex}`} role="list" aria-hidden={copyIndex > 0} ref={copyIndex === 0 ? sequenceRef : undefined}>
      {logos.map((item, itemIndex) => renderLogoItem(item, `${copyIndex}-${itemIndex}`))}
    </ul>
  )), [copyCount, logos, renderLogoItem])
  const containerStyle = useMemo(() => ({
    width: isVertical && toCssLength(width) === '100%' ? undefined : (toCssLength(width) ?? '100%'),
    ...variables,
    ...style,
  }), [width, variables, style, isVertical])

  return <div ref={containerRef} className={rootClassName} style={containerStyle} role="region" aria-label={ariaLabel}>
    <div
      className="logoloop__track"
      ref={trackRef}
      onMouseEnter={() => { if (effectiveHoverSpeed !== undefined) setIsHovered(true) }}
      onMouseLeave={() => { if (effectiveHoverSpeed !== undefined) setIsHovered(false) }}
    >
      {lists}
    </div>
  </div>
})

LogoLoop.displayName = 'LogoLoop'
export default LogoLoop
