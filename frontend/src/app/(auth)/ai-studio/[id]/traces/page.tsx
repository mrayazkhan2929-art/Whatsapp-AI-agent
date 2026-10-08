import {StudioInspector} from '@/components/studio/StudioPlayground'
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <StudioInspector id={id} view="traces"/>}
