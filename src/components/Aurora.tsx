import { useEffect, useRef, useState } from 'react'
import { Color, Mesh, Program, Renderer, Triangle } from 'ogl'
import './Aurora.css'

/*
 * Adapted from React Bits Aurora by David Haz.
 * Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause License Condition v1.0.
 * Source and full license: https://github.com/DavidHDev/react-bits
 */

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
    permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
    0.5 - vec3(
      dot(x0, x0),
      dot(x12.xy, x12.xy),
      dot(x12.zw, x12.zw)
    ),
    0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) { \
  int index = 0; \
  for (int i = 0; i < 2; i++) { \
    ColorStop currentColor = colors[i]; \
    bool isInBetween = currentColor.position <= factor; \
    index = int(mix(float(index), float(i), float(isInBetween))); \
  } \
  ColorStop currentColor = colors[index]; \
  ColorStop nextColor = colors[index + 1]; \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 auroraColor = intensity * rampColor;
  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`

export interface AuroraProps {
  colorStops?: string[]
  amplitude?: number
  blend?: number
  time?: number
  speed?: number
}

export default function Aurora(props: AuroraProps) {
  const { colorStops = ['#5227FF', '#7cff67', '#5227FF'], amplitude = 1, blend = 0.5 } = props
  const propsRef = useRef(props)
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldInitialize, setShouldInitialize] = useState(false)
  propsRef.current = props

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setShouldInitialize(true)
      observer.disconnect()
    }, { rootMargin: '300px' })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !shouldInitialize) return

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.canvas.style.backgroundColor = 'transparent'

    let program: Program | undefined
    const resize = () => {
      const width = Math.max(1, container.offsetWidth)
      const height = Math.max(1, container.offsetHeight)
      renderer.setSize(width, height)
      if (program) program.uniforms.uResolution.value = [width, height]
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    const geometry = new Triangle(gl)
    if (geometry.attributes.uv) delete geometry.attributes.uv
    const toColor = (hex: string) => {
      const color = new Color(hex)
      return [color.r, color.g, color.b]
    }

    program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStops.map(toColor) },
        uResolution: { value: [container.offsetWidth, container.offsetHeight] },
        uBlend: { value: blend },
      },
    })

    const mesh = new Mesh(gl, { geometry, program })
    container.appendChild(gl.canvas)

    let animationId = 0
    let inView = true
    let pageVisible = !document.hidden
    let lastFrameAt = 0
    let lastColorKey = colorStops.join('|')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frameInterval = 1000 / 30
    const update = (timestamp: number) => {
      animationId = 0
      if (!inView || !pageVisible) return
      if (!reduceMotion && timestamp - lastFrameAt < frameInterval) {
        animationId = requestAnimationFrame(update)
        return
      }
      lastFrameAt = timestamp
      const { time = timestamp * 0.01, speed = 1 } = propsRef.current
      if (!program) return
      program.uniforms.uTime.value = time * speed * 0.1
      program.uniforms.uAmplitude.value = propsRef.current.amplitude ?? 1
      program.uniforms.uBlend.value = propsRef.current.blend ?? blend
      const nextStops = propsRef.current.colorStops ?? colorStops
      const nextColorKey = nextStops.join('|')
      if (nextColorKey !== lastColorKey) {
        program.uniforms.uColorStops.value = nextStops.map(toColor)
        lastColorKey = nextColorKey
      }
      renderer.render({ scene: mesh })
      if (!reduceMotion) animationId = requestAnimationFrame(update)
    }
    const start = () => {
      if (inView && pageVisible && animationId === 0) animationId = requestAnimationFrame(update)
    }
    const stop = () => {
      if (animationId === 0) return
      cancelAnimationFrame(animationId)
      animationId = 0
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
    resize()
    start()

    return () => {
      stop()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibility)
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [amplitude, shouldInitialize])

  return <div ref={containerRef} className="aurora-container" />
}
