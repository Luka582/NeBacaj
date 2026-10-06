import { useEffect, useState } from 'react'

const SSR_FALLBACK_HEIGHT = 800

export function useViewportHeight(): number {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? SSR_FALLBACK_HEIGHT : window.innerHeight,
  )

  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', update)
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
    }
  }, [])

  return viewportHeight
}