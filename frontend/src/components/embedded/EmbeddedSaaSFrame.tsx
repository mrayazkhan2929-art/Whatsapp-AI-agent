'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface EmbeddedSaaSFrameProps {
  title: string
  src: string
  allow?: string
  className?: string
}

const LOAD_TIMEOUT_MS = 12000

export function EmbeddedSaaSFrame(props:EmbeddedSaaSFrameProps){
  return <EmbeddedSaaSFrameContent key={props.src} {...props}/>
}

function EmbeddedSaaSFrameContent({
  title,
  src,
  allow = 'clipboard-write',
  className,
}: EmbeddedSaaSFrameProps) {
  const [loaded, setLoaded] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [frameKey, setFrameKey] = useState(0)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setTimedOut(true)
    }, LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timeout)
  }, [frameKey, src])

  const handleRetry = () => {
    setLoaded(false)
    setTimedOut(false)
    setFrameKey((key) => key + 1)
  }

  return (
    <section
      aria-label={title}
      className={cn(
        'relative h-[calc(100vh-56px)] w-full overflow-hidden bg-background',
        className,
      )}
    >
      {!loaded && (
        <div className="absolute inset-0 z-10 flex flex-col gap-4 bg-background p-4 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64 max-w-[70vw]" />
            </div>
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
            <Skeleton className="min-h-40 rounded-lg md:col-span-2" />
            <Skeleton className="min-h-40 rounded-lg" />
            <Skeleton className="min-h-52 rounded-lg md:col-span-3" />
          </div>
        </div>
      )}

      {timedOut && !loaded && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-lg">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">{title} is taking longer than expected</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The embedded module may still be loading, or its frame security headers may need to allow this dashboard.
            </p>
            <Button onClick={handleRetry} className="mt-5 gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      )}

      <iframe
        key={frameKey}
        title={title}
        src={src}
        allow={allow}
        className="h-full w-full border-0"
        onLoad={() => setLoaded(true)}
        onError={() => setTimedOut(true)}
      />
    </section>
  )
}
