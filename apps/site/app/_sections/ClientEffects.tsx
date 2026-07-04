'use client'

import { useEffect, useRef } from 'react'

/**
 * RevealInit — mounts once, wires up scroll-reveal for every element carrying
 * the `.reveal` class.
 *
 * Progressive enhancement: markup renders fully visible by default (see
 * globals.css). Only after this effect confirms JS is running *and* the
 * visitor hasn't asked for reduced motion do we opt elements into the
 * hide-then-fade-in treatment, via a `.js-anim` class on <body>. This keeps
 * content visible if JS fails to load, and keeps `prefers-reduced-motion`
 * visitors free of transforms/transitions entirely.
 */
export function RevealInit() {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    document.body.classList.add('js-anim')

    const targets = Array.from(document.querySelectorAll('.reveal'))
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    for (const target of targets) observer.observe(target)

    return () => observer.disconnect()
  }, [])

  return null
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

/**
 * AmbientField — a faint, slow-drifting grid of points behind the hero.
 * Reads as data/telemetry texture rather than decoration. Renders a single
 * static frame (no rAF loop) under `prefers-reduced-motion: reduce`.
 */
export function AmbientField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let particles: Particle[] = []
    let frame = 0

    const seed = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.scale(dpr, dpr)

      const count = Math.round((width * height) / 26000)
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.4 + 0.4,
      }))
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(79, 200, 221, 0.55)'
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const step = () => {
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
      }
      draw()
      frame = requestAnimationFrame(step)
    }

    seed()
    draw()

    if (!prefersReducedMotion) {
      frame = requestAnimationFrame(step)
    }

    const handleResize = () => {
      seed()
      draw()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
}
