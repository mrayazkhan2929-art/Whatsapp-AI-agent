import {beforeEach,expect,it,vi} from 'vitest'
import {EmbeddingService} from '../../backend/src/rag/EmbeddingService'
const mock=vi.hoisted(()=>({key:'local-stub-only' as string|undefined,create:vi.fn()}))
vi.mock('../../backend/src/config/env',()=>({env:{get OPENAI_API_KEY(){return mock.key}}}))
vi.mock('openai',()=>({default:class{embeddings={create:mock.create}}}))
const vector=(value=1)=>[value,...Array(1535).fill(0)]
beforeEach(()=>{mock.key='local-stub-only';mock.create.mockReset()})
it('restores provider response order by index before pairing with chunks',async()=>{mock.create.mockResolvedValue({data:[{index:1,embedding:vector(2)},{index:0,embedding:vector(1)}]});expect((await EmbeddingService.embedBatch(['a','b'])).map(v=>v[0])).toEqual([1,2])})
it('missing provider credentials fail visibly without zero vectors',async()=>{mock.key=undefined;await expect(EmbeddingService.embedBatch(['a'])).rejects.toThrow('EMBEDDING_UNAVAILABLE');expect(mock.create).not.toHaveBeenCalled()})
it('provider batch failure propagates instead of silently succeeding',async()=>{mock.create.mockRejectedValue(Error('Provider unavailable'));await expect(EmbeddingService.embedBatch(['a'])).rejects.toThrow();expect(mock.create).toHaveBeenCalledTimes(1)})
it.each([[{index:0,embedding:Array(1536).fill(0)}],[{index:1,embedding:vector()}],[]])('rejects malformed batch response %#',async(...data)=>{mock.create.mockResolvedValue({data});await expect(EmbeddingService.embedBatch(['a'])).rejects.toThrow('INVALID_EMBEDDING_RESPONSE')})
it('splits large batches within the provider batch limit',async()=>{mock.create.mockImplementation(async({input}:{input:string[]})=>({data:input.map((_,index)=>({index,embedding:vector()}))}));expect(await EmbeddingService.embedBatch(Array(201).fill('text'))).toHaveLength(201);expect(mock.create.mock.calls.map(c=>c[0].input.length)).toEqual([100,100,1])})
it('empty batches need no provider',async()=>{mock.key=undefined;expect(await EmbeddingService.embedBatch([])).toEqual([]);expect(mock.create).not.toHaveBeenCalled()})
