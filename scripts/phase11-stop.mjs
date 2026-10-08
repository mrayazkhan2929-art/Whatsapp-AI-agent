import {writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
writeFileSync(resolve(import.meta.dirname,'../test-results/phase11-review.stop'),'stop\n')
console.log('Requested local review shutdown and disposable stack cleanup')
