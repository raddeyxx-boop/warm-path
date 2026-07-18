function vertices(cx, cy, r, n) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  })
}

function roundedPolygonPath(cx, cy, r, n, rFrac) {
  const pts = vertices(cx, cy, r, n)
  const parts = []

  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n]
    const curr = pts[i]
    const next = pts[(i + 1) % n]

    const d1x = curr[0] - prev[0]
    const d1y = curr[1] - prev[1]
    const len1 = Math.hypot(d1x, d1y)
    const d2x = next[0] - curr[0]
    const d2y = next[1] - curr[1]
    const len2 = Math.hypot(d2x, d2y)
    const cr = Math.min(len1, len2) * rFrac

    const p1x = curr[0] - (d1x / len1) * cr
    const p1y = curr[1] - (d1y / len1) * cr
    const p2x = curr[0] + (d2x / len2) * cr
    const p2y = curr[1] + (d2y / len2) * cr

    parts.push(`${i === 0 ? 'M' : 'L'} ${p1x.toFixed(2)} ${p1y.toFixed(2)}`)
    parts.push(`Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${p2x.toFixed(2)} ${p2y.toFixed(2)}`)
  }

  parts.push('Z')
  return parts.join(' ')
}

const SURFACE_OPACITIES = {
  light: { outerOpacity: 1, innerFillOpacity: 0.1, innerOpacity: 0.75, strokeWidth: 2.5 },
  'card-light': { outerOpacity: 0.55, innerFillOpacity: 0.1, innerOpacity: 0.6, strokeWidth: 1.5 },
  'mid-dark': { outerOpacity: 0.3, innerFillOpacity: 0.07, innerOpacity: 0.4, strokeWidth: 1.5 },
  'deep-dark': { outerOpacity: 0.18, innerFillOpacity: 0.055, innerOpacity: 0.19, strokeWidth: 1.5 },
}

export function PolygonMotif({
  size,
  sides = 5,
  cornerRounding = 0.08,
  style,
  className,
  surface = 'light',
}) {
  const { outerOpacity, innerFillOpacity, innerOpacity, strokeWidth } = SURFACE_OPACITIES[surface]
  const cx = size / 2
  const cy = size / 2
  const outerR = size * 0.48
  const innerR = size * 0.34
  const outerPath = roundedPolygonPath(cx, cy, outerR, sides, cornerRounding)
  const innerPath = roundedPolygonPath(cx, cy, innerR, sides, cornerRounding)

  return (
    <div
      aria-hidden="true"
      className="polygon-motif-wrap"
      style={{
        position: 'absolute',
        width: `${size}px`,
        height: `${size}px`,
        pointerEvents: 'none',
        zIndex: 0,
        ...style,
      }}
    >
      <svg
        className={className}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
        viewBox={`0 0 ${size} ${size}`}
      >
        <path
          d={outerPath}
          fill="none"
          stroke="#E7B961"
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          opacity={outerOpacity}
        />
        <path
          d={innerPath}
          fill="#E7B961"
          fillOpacity={innerFillOpacity}
          stroke="#E7B961"
          strokeWidth={strokeWidth * 0.6}
          strokeLinejoin="round"
          opacity={innerOpacity}
        />
      </svg>
    </div>
  )
}
