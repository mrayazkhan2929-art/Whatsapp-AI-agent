import type {NextRequest} from 'next/server'
// Next may normalize the internal server URL to localhost. Compare the browser
// origin with the HTTP authority too, without trusting a client org or redirect.
export function isSameOrigin(request:NextRequest):boolean{
  const origin=request.headers.get('origin')
  if(!origin)return true
  try{const url=new URL(origin);return url.origin===request.nextUrl.origin||(url.host===request.headers.get('host')&&url.protocol===request.nextUrl.protocol)}catch{return false}
}
