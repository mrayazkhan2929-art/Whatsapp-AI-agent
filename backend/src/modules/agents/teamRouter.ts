import { TeamRoutingService } from './TeamRoutingService.js'
export const teamRouter={findAgent:(orgId:string,contactInfo:{area?:string;budget?:number})=>new TeamRoutingService().select(orgId,contactInfo)}
