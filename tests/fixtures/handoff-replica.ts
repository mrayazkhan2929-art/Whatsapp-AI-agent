import { getSupabaseAdmin } from '../../backend/src/config/supabase'
import { HandoffCoordinator } from '../../backend/src/modules/handoff/HandoffCoordinator'
import { HumanNotificationService } from '../../backend/src/modules/handoff/HumanNotificationService'
import { TeamRoutingService } from '../../backend/src/modules/agents/TeamRoutingService'
const db=getSupabaseAdmin()
const coordinator=new HandoffCoordinator(db,new TeamRoutingService(db),new HumanNotificationService(db,async()=>{process.send?.({kind:'effect',effect:'notify'});return{}}))
process.on('message',async(payload:{org:string;device:string})=>{
 try{await coordinator.recover(payload.org,payload.device);process.send?.({kind:'done'})}
 catch{process.send?.({kind:'failed'})}
})
process.send?.({kind:'ready'})
