import { MessageRouter } from '../../backend/src/whatsapp/MessageRouter'
import type { WAMessage } from '@whiskeysockets/baileys'

const router = new MessageRouter({
  generateReply: async input => {
    process.send?.({kind:'effect',effect:'execute',content:input.message})
    await new Promise(resolve=>setTimeout(resolve,20))
    return {reply:'Saved replica reply',lane:'CHAT',lang:'en',handoff:false,replyMode:'prebuilt',intent:{} as never}
  },
  send: async input => {
    process.send?.({kind:'effect',effect:'send',id:input.messageId})
    return {deviceId:input.deviceId,messageId:input.messageId}
  },
})
process.on('message',async(payload:{id:string;device:string;org:string;event:WAMessage})=>{
  await router.routeMessage(payload.device,payload.org,payload.event)
  process.send?.({kind:'done',id:payload.id})
})
process.send?.({kind:'ready'})
