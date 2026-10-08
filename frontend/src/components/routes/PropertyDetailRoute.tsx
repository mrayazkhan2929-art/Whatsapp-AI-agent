'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BedDouble, Building2, MapPin, Phone, Ruler } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ROICalculator } from '@/components/properties/ROICalculator'

interface PropertyDetail {
  id: string
  refNumber: string
  transactionType: string
  category: string
  type: string|null
  project: string|null
  developer: string|null
  bedrooms: string | null
  bathrooms: string | null
  sizeSqft: number | null
  status: string | null
  district: string | null
  building: string | null
  fullArea: string | null
  priceAed: number
  agentName: string | null
  agentWhatsapp: string | null
  available: boolean
}

function formatCurrency(value: number): string {
  return `AED ${value.toLocaleString()}`
}

export function PropertyDetailRoute({ propertyRef }: { propertyRef: string }) {
  const propertyQuery = useQuery<{ data: PropertyDetail }>({
    queryKey: ['property-detail-page', propertyRef],
    queryFn: async () => {
      const response = await fetch(`/api/properties/${encodeURIComponent(propertyRef)}`)
      if (!response.ok) {
        throw new Error('Failed to load property')
      }
      return response.json()
    },
  })

  const property = propertyQuery.data?.data
  const mediaQuery=useQuery<{ data:Array<{ id?:string;url:string;media_type:string }> }>({
    queryKey:['property-media',propertyRef],enabled:!!property,
    queryFn:async()=>{ const response=await fetch(`/api/properties/${encodeURIComponent(propertyRef)}/media`);if(!response.ok)throw new Error('Media could not be loaded');return response.json() },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" className="mb-2 -ml-3 w-fit gap-2">
            <Link href="/properties">
              <ArrowLeft className="h-4 w-4" />
              Back to properties
            </Link>
          </Button>
          <h1 className="text-display">Property Detail</h1>
          <p className="text-subtitle">
            Listing facts, available media and your investment workspace.
          </p>
        </div>
        {property ? (
          <Badge variant={property.available ? 'default' : 'secondary'} className="w-fit">
            {property.available ? 'Available' : 'Unavailable'}
          </Badge>
        ) : null}
      </div>

      {propertyQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : property ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-emerald-600" />
                  {property.refNumber}
                </CardTitle>
                <CardDescription>
                  {property.type || 'Property'}{property.district ? ` in ${property.district}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-3xl font-bold text-emerald-600">
                  {formatCurrency(property.priceAed)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{property.transactionType}</Badge>
                  {property.status ? <Badge variant="outline">{property.status}</Badge> : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <BedDouble className="h-4 w-4" />
                      Rooms
                    </div>
                    <div className="mt-2 font-semibold">
                      {property.bedrooms || 'N/A'} beds - {property.bathrooms || 'N/A'} baths
                    </div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Ruler className="h-4 w-4" />
                      Size
                    </div>
                    <div className="mt-2 font-semibold">
                      {property.sizeSqft !== null ? `${property.sizeSqft.toLocaleString()} sqft` : 'Not recorded'}
                    </div>
                  </div>
                  <div className="rounded-xl border p-4 sm:col-span-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      Location
                    </div>
                    <div className="mt-2 font-semibold">
                      {[...new Set([property.building, property.fullArea, property.district]
                        .filter(Boolean)
                      )]
                        .join(' - ') || 'Location unavailable'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Agent Ownership</CardTitle>
                <CardDescription>Listing assignment and direct contact context</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border p-4">
                  <div className="text-sm text-muted-foreground">Agent name</div>
                  <div className="mt-2 text-lg font-semibold">
                    {property.agentName || 'Not recorded'}
                  </div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    Agent WhatsApp
                  </div>
                  <div className="mt-2 text-lg font-semibold">
                    {property.agentWhatsapp || 'Not recorded'}
                  </div>
                </div>
                {property.project ? <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Project</div><p className="mt-2 font-semibold">{property.project}</p></div> : null}
                {property.developer ? <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Developer</div><p className="mt-2 font-semibold">{property.developer}</p></div> : null}
              </CardContent>
            </Card>
          </div>

          <Card className="border-emerald-100 dark:border-emerald-900/40">
            <CardHeader><CardTitle><h2>Listing media</h2></CardTitle><CardDescription>Explore the assets recorded for this property.</CardDescription></CardHeader>
            <CardContent>
              {mediaQuery.isLoading ? <Skeleton className="h-20 rounded-xl" /> : mediaQuery.isError ? <p role="alert" className="text-sm text-muted-foreground">Media could not be loaded. Please refresh to try again.</p> : mediaQuery.data?.data.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mediaQuery.data.data.map((media,index)=><a key={media.id ?? media.url} href={media.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border bg-muted/20 p-4 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><span className="text-xs uppercase tracking-wide text-muted-foreground">{media.media_type.replace('_',' ')}</span><p className="mt-2 font-medium">Open {media.media_type.replace('_',' ')} {index+1}<span className="sr-only"> in a new tab</span></p></a>)}</div>
              ) : <p className="text-sm text-muted-foreground">No media is recorded for this listing yet.</p>}
            </CardContent>
          </Card>

          <ROICalculator
            initialPrice={property.priceAed}
            district={property.district}
            sizeSqft={property.sizeSqft}
          />
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Property not found or unavailable for this organization.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
