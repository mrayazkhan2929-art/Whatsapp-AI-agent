export function safeRedirect(value:string|null,fallback='/dashboard'):string{
  if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return fallback
  try{
    const url=new URL(value,'https://workspace.invalid')
    if(url.origin!=='https://workspace.invalid'||['/login','/register'].some(path=>url.pathname.startsWith(path)))return fallback
    return url.pathname+url.search+url.hash
  }catch{return fallback}
}
