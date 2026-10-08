'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  Layers,
  Building2,
  MapPin,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface TopArea {
  area: string
  count: number
}

interface PropertyStats {
  total: number
  direct: number
  indirect: number
  available: number
  unavailable: number
  availabilityPct: number
  sale: number
  rent: number
  ready: number
  offPlan: number
  avgPriceAed: number
  topAreas: TopArea[]
}

function formatAed(value: number): string {
  if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `AED ${(value / 1_000).toFixed(0)}K`
  return `AED ${value.toLocaleString()}`
}

export function PropertyStatsWidget() {
  const [stats, setStats] = useState<PropertyStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/properties/stats')
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Card className="card-hover hover-lift">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            Property Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading property stats...
        </CardContent>
      </Card>
    )
  }

  const total = stats?.total ?? 0
  const direct = stats?.direct ?? 0
  const indirect = stats?.indirect ?? 0
  const available = stats?.available ?? 0
  const availabilityPct = stats?.availabilityPct ?? 0
  const sale = stats?.sale ?? 0
  const rent = stats?.rent ?? 0
  const avgPriceAed = stats?.avgPriceAed ?? 0
  const topArea = stats?.topAreas?.[0]
  const directPct = total > 0 ? Math.round((direct / total) * 100) : 0
  const indirectPct = total > 0 ? Math.round((indirect / total) * 100) : 0
  const salePct = total > 0 ? Math.round((sale / total) * 100) : 0
  const rentPct = total > 0 ? Math.round((rent / total) * 100) : 0

  return (
    <Card className="card-hover hover-lift">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 p-1.5">
              <BarChart3 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            Property Statistics
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Layers className="h-3 w-3" />
            {total > 0 ? `${total} listings` : 'No data'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
            <p className="text-[10px] font-medium text-muted-foreground">Direct Portfolio</p>
            <p className="mt-1 text-lg font-bold text-emerald-600">{direct}</p>
            <p className="text-[10px] text-muted-foreground">{directPct}% of inventory</p>
          </div>
          <div className="rounded-lg bg-blue-50/60 p-3 dark:bg-blue-950/20">
            <p className="text-[10px] font-medium text-muted-foreground">Indirect Portfolio</p>
            <p className="mt-1 text-lg font-bold text-blue-600">{indirect}</p>
            <p className="text-[10px] text-muted-foreground">{indirectPct}% of inventory</p>
          </div>
          <div className="rounded-lg bg-amber-50/60 p-3 dark:bg-amber-950/20">
            <p className="text-[10px] font-medium text-muted-foreground">Average Price</p>
            <p className="mt-1 text-lg font-bold">{avgPriceAed > 0 ? formatAed(avgPriceAed) : '—'}</p>
            <p className="text-[10px] text-muted-foreground">Across direct and partner stock</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-[10px] font-medium text-muted-foreground">Available Now</p>
            <p className="mt-1 text-lg font-bold">{available}</p>
            <p className="text-[10px] text-muted-foreground">{availabilityPct}% currently active</p>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source Split</h4>
          <div className="h-4 overflow-hidden rounded-full bg-muted">
            <div
              className="flex h-full"
              title={`Direct ${directPct}% | Indirect ${indirectPct}%`}
            >
              <div
                className="flex items-center justify-center bg-emerald-500 text-[8px] font-bold text-white"
                style={{ width: `${directPct}%` }}
              >
                {directPct >= 18 ? `${directPct}%` : ''}
              </div>
              <div
                className="flex items-center justify-center bg-blue-500 text-[8px] font-bold text-white"
                style={{ width: `${indirectPct}%` }}
              >
                {indirectPct >= 18 ? `${indirectPct}%` : ''}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Direct ({direct})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
              Indirect ({indirect})
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transaction Mix</h4>
          <div className="h-4 overflow-hidden rounded-full bg-muted">
            <div className="flex h-full" title={`Sale ${salePct}% | Rent ${rentPct}%`}>
              <div
                className="flex items-center justify-center bg-emerald-500 text-[8px] font-bold text-white"
                style={{ width: `${salePct}%` }}
              >
                {salePct >= 18 ? `${salePct}%` : ''}
              </div>
              <div
                className="flex items-center justify-center bg-sky-500 text-[8px] font-bold text-white"
                style={{ width: `${rentPct}%` }}
              >
                {rentPct >= 18 ? `${rentPct}%` : ''}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Sale ({sale})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
              Rent ({rent})
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Area</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-emerald-600" />
                {topArea?.area ?? '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {topArea ? `${topArea.count} listings in portfolio` : 'No area data yet'}
              </p>
            </div>
            <div className="rounded-lg bg-background p-2 shadow-sm">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
