/* ------------------------------------------------------------------- markup
   Freeform ink over the case file. A student circles the conclusion, strikes
   out a choice they have ruled out, and diagrams a conditional chain the way
   they would on paper next to the real test.

   The ink is deliberately ephemeral. It belongs to the question in front of
   you and is gone when you turn the page; nothing is sent to the server and
   nothing survives a reload.

   One layer per card, parented inside the card. Both cards are their own
   scroll containers at every breakpoint — the passage scrolls internally on
   desktop, and on a phone each pane scrolls independently — so ink parented
   inside a card scrolls with its own text for free, with no scroll
   projection and no redraw on scroll.

   SVG rather than a canvas, for three reasons that are all real work
   otherwise: the answer card grows a lot when the verdict mounts and SVG
   reflows without a redraw pass, strokes are crisp on any device pixel ratio
   without scaling maths, and a translucent highlighter drawn as one path with
   `stroke-opacity` paints as a single shape — an incrementally drawn canvas
   stroke double-darkens at every overlap and joint.
*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Eraser, Highlighter, MousePointer2, Pencil, Trash2, Undo2 } from 'lucide-react'
import { useSound } from './sound'

export type MarkupSurface = 'passage' | 'answer'
export type MarkupTool = 'pointer' | 'pen' | 'highlighter' | 'eraser'
export type InkColor = 'navy' | 'red' | 'gold'

type Point = [number, number]

export type Stroke = {
  id: string
  surface: MarkupSurface
  tool: 'pen' | 'highlighter'
  color: InkColor
  points: Point[]
}

/* The case-file palette, so ink reads as part of the document rather than as
   something bolted onto it. Matches --navy, --red and --gold-dark. */
const INK_HEX: Record<InkColor, string> = {
  navy: '#102735',
  red: '#a84645',
  gold: '#9a6c28',
}

const INK_LABEL: Record<InkColor, string> = {
  navy: 'Navy ink',
  red: 'Red ink',
  gold: 'Gold ink',
}

const INK_ORDER: InkColor[] = ['navy', 'red', 'gold']

const PEN_WIDTH = 2.4
const HIGHLIGHTER_WIDTH = 15
const HIGHLIGHTER_OPACITY = 0.32
/* Points closer together than this add nothing a reader can see and inflate
   the path data, so a fast scribble stays cheap. */
const MIN_POINT_DISTANCE = 2
const ERASE_RADIUS = 11

const round = (value: number) => Math.round(value * 100) / 100

/* Quadratic midpoint smoothing. Each sampled point becomes a control point and
   the curve passes through the midpoints, which turns a jittery pointer trace
   into a line that looks drawn rather than plotted. */
export function strokePath(points: Point[]): string {
  if (points.length === 0) return ''
  const first = points[0]
  /* A tap is a dot: a zero-length segment painted with a round linecap. */
  if (points.length === 1) return `M ${round(first[0])} ${round(first[1])} l 0 0`
  let d = `M ${round(first[0])} ${round(first[1])}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const [controlX, controlY] = points[index]
    const [nextX, nextY] = points[index + 1]
    d += ` Q ${round(controlX)} ${round(controlY)} ${round((controlX + nextX) / 2)} ${round((controlY + nextY) / 2)}`
  }
  const last = points[points.length - 1]
  return `${d} L ${round(last[0])} ${round(last[1])}`
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/* The eraser takes whole strokes rather than pixels. That is both simpler and
   the better behaviour for markup — one pass removes the circle you drew
   instead of nibbling a gap into it. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius = ERASE_RADIUS) {
  const reach = radius + (stroke.tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH) / 2
  const { points } = stroke
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= reach
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, ay] = points[index]
    const [bx, by] = points[index + 1]
    if (distanceToSegment(x, y, ax, ay, bx, by) <= reach) return true
  }
  return false
}

export function useCaseMarkup(itemId: string | undefined) {
  const [tool, setTool] = useState<MarkupTool>('pointer')
  const [color, setColor] = useState<InkColor>('navy')
  const [strokes, setStrokes] = useState<Stroke[]>([])

  /* A new question starts on a clean page with drawing disarmed, so a page
     turn never lands a student mid-stroke over a question they have not read
     yet. */
  useEffect(() => {
    setStrokes([])
    setTool('pointer')
  }, [itemId])

  useEffect(() => {
    if (tool === 'pointer') return
    const disarm = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTool('pointer')
    }
    window.addEventListener('keydown', disarm)
    return () => window.removeEventListener('keydown', disarm)
  }, [tool])

  const addStroke = useCallback((stroke: Stroke) => {
    setStrokes((current) => [...current, stroke])
  }, [])

  const eraseAt = useCallback((surface: MarkupSurface, x: number, y: number) => {
    setStrokes((current) => {
      const kept = current.filter((stroke) => stroke.surface !== surface || !strokeHit(stroke, x, y))
      return kept.length === current.length ? current : kept
    })
  }, [])

  const undo = useCallback(() => setStrokes((current) => current.slice(0, -1)), [])
  const clear = useCallback(() => setStrokes([]), [])

  return { tool, setTool, color, setColor, strokes, addStroke, eraseAt, undo, clear }
}

export type CaseMarkup = ReturnType<typeof useCaseMarkup>

export function MarkupToolbar({ markup, seed }: { markup: CaseMarkup; seed: string }) {
  const { tool, setTool, color, setColor, strokes, undo, clear } = markup
  const { play } = useSound()

  const pick = (next: MarkupTool) => {
    setTool(next)
    void play('select', { seed: `${seed}:markup:${next}`, intensity: 0.3 })
  }

  /* Reaching for a colour means you want to write with it. */
  const pickColor = (next: InkColor) => {
    setColor(next)
    if (tool === 'pointer' || tool === 'eraser') setTool('pen')
    void play('select', { seed: `${seed}:markup:${next}`, intensity: 0.28 })
  }

  const tools: Array<{ key: MarkupTool; label: string; hint: string; icon: typeof Pencil }> = [
    { key: 'pointer', label: 'Read', hint: 'Read and answer — marks stay visible', icon: MousePointer2 },
    { key: 'pen', label: 'Pen', hint: 'Draw on the case file', icon: Pencil },
    { key: 'highlighter', label: 'Mark', hint: 'Highlight the case file', icon: Highlighter },
    { key: 'eraser', label: 'Erase', hint: 'Remove a mark', icon: Eraser },
  ]

  return (
    <div className={`markup-toolbar ${tool === 'pointer' ? '' : 'is-armed'}`} role="toolbar" aria-label="Case markup tools">
      <span className="markup-toolbar-label" aria-hidden="true">MARKUP</span>
      <div className="markup-tools">
        {tools.map(({ key, label, hint, icon: Icon }) => (
          <button
            type="button"
            key={key}
            className={tool === key ? 'active' : ''}
            aria-pressed={tool === key}
            aria-label={hint}
            title={hint}
            onClick={() => pick(key)}
          >
            <Icon size={15} />
            <em>{label}</em>
          </button>
        ))}
      </div>
      <div className="markup-colors" role="group" aria-label="Ink colour">
        {INK_ORDER.map((key) => (
          <button
            type="button"
            key={key}
            className={`markup-color ${color === key ? 'active' : ''}`}
            style={{ '--ink': INK_HEX[key] } as React.CSSProperties}
            aria-pressed={color === key}
            aria-label={INK_LABEL[key]}
            title={INK_LABEL[key]}
            onClick={() => pickColor(key)}
          />
        ))}
      </div>
      <div className="markup-history">
        <button
          type="button"
          disabled={strokes.length === 0}
          aria-label="Undo the last mark"
          title="Undo the last mark"
          onClick={() => {
            undo()
            void play('paper', { seed: `${seed}:markup:undo`, intensity: 0.22 })
          }}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          disabled={strokes.length === 0}
          aria-label="Clear every mark on this question"
          title="Clear every mark on this question"
          onClick={() => {
            clear()
            void play('paper', { seed: `${seed}:markup:clear`, intensity: 0.32 })
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

/* Renders the ink for one card plus the sentinel that measures it. Both are
   direct children of the card: the phone layout turns each card into a flex
   column whose direct children are deliberately `flex: 0 0 auto`, so wrapping
   the content would break the pane that pushes its action bar to the foot. */
export function MarkupLayer({ markup, surface }: { markup: CaseMarkup; surface: MarkupSurface }) {
  const { tool, color, strokes, addStroke, eraseAt } = markup
  const layerRef = useRef<SVGSVGElement>(null)
  const extentRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<Stroke | null>(null)
  const drawingRef = useRef(false)
  const [draft, setDraft] = useState<Stroke | null>(null)
  const [height, setHeight] = useState(0)
  const armed = tool !== 'pointer'

  /* A layer with `inset: 0` inside a scroll container resolves against the
     padding box: it scrolls with the content correctly but stands only one
     screenful tall, so pointer hit-testing dies below the fold. Sizing it from
     `scrollHeight` deadlocks instead — the layer is out of flow, so it feeds
     its own height back into the container's scroll overflow and the height
     never comes down again once the content shrinks.

     The zero-height sentinel breaks that loop. It is the last in-flow child,
     so its `offsetTop` is exactly the content height, and an out-of-flow layer
     cannot push it down. Measuring on every render and committing only on a
     real change settles in one extra pass and costs nothing after that. */
  const measure = useCallback(() => {
    const extent = extentRef.current
    /* `display: none` during the phone pane swap measures zero. Keep the last
       good height so the ink is intact when the pane comes back. */
    if (!extent || extent.offsetParent === null) return
    const next = extent.offsetTop
    setHeight((current) => (Math.abs(current - next) > 0.5 ? next : current))
  }, [])

  useLayoutEffect(measure)

  useEffect(() => {
    const card = layerRef.current?.parentElement
    if (!card || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [measure])

  const pointFrom = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top]
  }

  const setDraftStroke = (next: Stroke | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!armed || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    const [x, y] = pointFrom(event)
    if (tool === 'eraser') {
      eraseAt(surface, x, y)
      return
    }
    setDraftStroke({
      id: `${surface}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
      surface,
      tool,
      color,
      points: [[x, y]],
    })
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!armed || !drawingRef.current) return
    const [x, y] = pointFrom(event)
    if (tool === 'eraser') {
      eraseAt(surface, x, y)
      return
    }
    const current = draftRef.current
    if (!current) return
    const last = current.points[current.points.length - 1]
    if (Math.hypot(x - last[0], y - last[1]) < MIN_POINT_DISTANCE) return
    setDraftStroke({ ...current, points: [...current.points, [x, y]] })
  }

  const endStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const finished = draftRef.current
    if (finished) addStroke(finished)
    setDraftStroke(null)
  }

  const painted = useMemo(() => strokes.filter((stroke) => stroke.surface === surface), [strokes, surface])
  const visible = draft ? [...painted, draft] : painted

  return (
    <>
      <svg
        ref={layerRef}
        className="markup-layer"
        data-armed={armed ? 'true' : undefined}
        data-tool={tool}
        style={{ height: height || undefined }}
        aria-hidden="true"
        focusable="false"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      >
        {visible.map((stroke) => (
          <path
            key={stroke.id}
            d={strokePath(stroke.points)}
            fill="none"
            stroke={INK_HEX[stroke.color]}
            strokeWidth={stroke.tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH}
            strokeOpacity={stroke.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div ref={extentRef} className="markup-extent" aria-hidden="true" />
    </>
  )
}
