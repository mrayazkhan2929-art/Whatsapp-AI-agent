import {createClient} from '@supabase/supabase-js'
import {readFileSync} from 'node:fs'
import {KnowledgeIngestion} from '../../backend/src/rag/KnowledgeIngestion'
const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8')),db=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false}})
const ingestion=new KnowledgeIngestion(db,async texts=>{process.send?.({kind:'effect',count:texts.length});return texts.map(()=>[1,...Array(1535).fill(0)])})
process.on('message',async(message:{org:string})=>{try{await ingestion.recover(message.org);process.send?.({kind:'done'})}catch{process.send?.({kind:'failed'})}})
process.send?.({kind:'ready'})
