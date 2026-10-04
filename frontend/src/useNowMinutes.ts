import { useEffect, useState } from 'react'
import { getSerbiaMinutes } from './format'

export function useNowMinutes(): number {
  const [nowMinutes, setNowMinutes] = useState(getSerbiaMinutes)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      timer = setTimeout(() => {
        setNowMinutes(getSerbiaMinutes())
        schedule()
      }, Math.max(1000, 60000 - (Date.now() % 60000) + 50))
    }
    schedule()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return nowMinutes
}