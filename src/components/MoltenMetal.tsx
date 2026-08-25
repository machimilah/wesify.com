import { useEffect, useRef } from 'react'
import { Mesh, Program, Renderer, Triangle } from 'ogl'

/*
 * Adapted from React Bits MoltenMetal by David Haz.
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0.
 * Permission is granted to use, copy, modify, merge, publish, and distribute this software as part
 * of an application, website, or product, provided this notice remains included. The component may
 * not itself be sold, sublicensed, redistributed, bundled, or ported for redistribution.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 * Source and full license: https://github.com/DavidHDev/react-bits
 */

export type MoltenMetalColorMode = 'molten' | 'ember' | 'frost'

export interface MoltenMetalProps {
  color1?: string
  color2?: string
  color3?: string
  speed?: number
  scale?: number
  detail?: number
  glow?: number
  coreSize?: number
  swirl?: number
  fold?: number
  blackPoint?: number
  brightness?: number
  colorMode?: MoltenMetalColorMode
  grain?: boolean
  grainIntensity?: number
  mouseInteraction?: boolean
  mouseStrength?: number
  baseOpacity?: number
  opacity?: number
  className?: string
}

const vertex = `#version 300 es
in vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = `#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uColorMode;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uBaseOpacity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;
  vec2 drift = vec2(0.0);

  if (uEnableMouse) {
    drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  }

  p += drift;
  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;
  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
  }

  c /= 6.0;
  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;
  float g = clamp(intensity, 0.0, 1.0);
  float mid = 0.5;

  if (uColorMode > 1.5) {
    mid = 0.65;
  } else if (uColorMode > 0.5) {
    mid = 0.35;
  }

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
  col = mix(col, uColor3, smoothstep(mid, 1.0, g));
  float alpha = mix(uBaseOpacity, 1.0, g);

  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    alpha += (gr - 0.5) * uGrainIntensity;
  }

  alpha = clamp(alpha, 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * alpha, alpha);
}
`

const hexToRgb = (hex: string): [number, number, number] => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) return [1, 1, 1]
  return [
    Number.parseInt(match[1], 16) / 255,
    Number.parseInt(match[2], 16) / 255,
    Number.parseInt(match[3], 16) / 255,
  ]
}

const colorModeValue = (mode: MoltenMetalColorMode) => mode === 'ember' ? 1 : mode === 'frost' ? 2 : 0

export function MoltenMetal({
  color1 = '#5227FF',
  color2 = '#FF9FFC',
  color3 = '#FFFFFF',
  speed = 0.35,
  scale = 4,
  detail = 3,
  glow = 1.6,
  coreSize = 0.1,
  swirl = 1,
  fold = -0.2,
  blackPoint = 0.05,
  brightness = 1.3,
  colorMode = 'molten',
  grain = true,
  grainIntensity = 0.05,
  mouseInteraction = true,
  mouseStrength = 0.3,
  baseOpacity = 0,
  opacity = 1,
  className = '',
}: MoltenMetalProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: Renderer
    try {
      const viewportPixels = window.innerWidth * window.innerHeight
      const dprCap = viewportPixels > 1_600_000 ? 1 : viewportPixels > 800_000 ? 1.25 : 1.5
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, dprCap),
        powerPreference: 'high-performance',
      })
    } catch {
      return
    }

    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: speed },
        uScale: { value: scale },
        uDetail: { value: detail },
        uGlow: { value: glow },
        uCoreSize: { value: Math.max(coreSize, 0.001) },
        uSwirl: { value: swirl },
        uFold: { value: fold },
        uBlackPoint: { value: blackPoint },
        uBrightness: { value: brightness },
        uColorMode: { value: colorModeValue(colorMode) },
        uGrain: { value: grain ? 1 : 0 },
        uGrainIntensity: { value: grainIntensity },
        uBaseOpacity: { value: Math.min(Math.max(baseOpacity, 0), 1) },
        uOpacity: { value: opacity },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: mouseStrength },
        uEnableMouse: { value: mouseInteraction },
        uColor1: { value: new Float32Array(hexToRgb(color1)) },
        uColor2: { value: new Float32Array(hexToRgb(color2)) },
        uColor3: { value: new Float32Array(hexToRgb(color3)) },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    const resize = () => {
      const rect = container.getBoundingClientRect()
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)))
      const resolution = program.uniforms.iResolution.value as Float32Array
      resolution[0] = gl.drawingBufferWidth
      resolution[1] = gl.drawingBufferHeight
      renderer.render({ scene: mesh })
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    let inView = true
    let pageVisible = !document.hidden
    const targetMouse: [number, number] = [0.5, 0.5]
    const currentMouse: [number, number] = [0.5, 0.5]
    const handlePointerMove = (event: PointerEvent) => {
      if (!inView) return
      const rect = container.getBoundingClientRect()
      targetMouse[0] = (event.clientX - rect.left) / rect.width
      targetMouse[1] = 1 - (event.clientY - rect.top) / rect.height
    }
    const handlePointerLeave = () => {
      targetMouse[0] = 0.5
      targetMouse[1] = 0.5
    }

    if (mouseInteraction) {
      window.addEventListener('pointermove', handlePointerMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', handlePointerLeave)
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animationFrame = 0
    let frameTimer = 0
    const startedAt = performance.now()
    const frameInterval = 1000 / 30
    let lastFrameAt = 0

    const draw = (time: number) => {
      animationFrame = 0
      if (!inView || !pageVisible) return
      lastFrameAt = time
      program.uniforms.iTime.value = reduceMotion ? 0 : (time - startedAt) * 0.001
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0])
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1])
      const mouse = program.uniforms.uMouse.value as Float32Array
      mouse[0] = currentMouse[0]
      mouse[1] = currentMouse[1]
      renderer.render({ scene: mesh })
      if (!reduceMotion) schedule()
    }
    const schedule = () => {
      if (reduceMotion || !inView || !pageVisible || animationFrame !== 0 || frameTimer !== 0) return
      const delay = Math.max(0, frameInterval - (performance.now() - lastFrameAt))
      frameTimer = window.setTimeout(() => {
        frameTimer = 0
        if (inView && pageVisible) animationFrame = requestAnimationFrame(draw)
      }, delay)
    }
    const start = () => {
      if (reduceMotion) {
        if (animationFrame === 0) animationFrame = requestAnimationFrame(draw)
        return
      }
      schedule()
    }
    const stop = () => {
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame)
      if (frameTimer !== 0) window.clearTimeout(frameTimer)
      animationFrame = 0
      frameTimer = 0
    }

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      if (inView) start()
      else stop()
    })
    intersectionObserver.observe(container)

    const handleVisibility = () => {
      pageVisible = !document.hidden
      if (pageVisible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    start()

    return () => {
      stop()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pointermove', handlePointerMove)
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave)
      canvas.remove()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [baseOpacity, blackPoint, brightness, color1, color2, color3, colorMode, coreSize, detail, fold, glow, grain, grainIntensity, mouseInteraction, mouseStrength, opacity, scale, speed, swirl])

  return <div ref={containerRef} className={`molten-metal-container ${className}`.trim()} />
}
