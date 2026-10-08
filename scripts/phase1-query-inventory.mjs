import ts from 'typescript'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname,'..')
const queries = []
function inspect(directory) {
  for (const entry of readdirSync(resolve(root,directory),{ withFileTypes:true })) {
    const file = directory+'/'+entry.name
    if (entry.isDirectory()) { inspect(file); continue }
    if (!/\.tsx?$/.test(file)) continue
    const source = ts.createSourceFile(file,readFileSync(resolve(root,file),'utf8'),ts.ScriptTarget.Latest,true)
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['from','rpc'].includes(node.expression.name.text) && !['Array','Buffer'].includes(node.expression.expression.getText(source))) {
        let chain = node
        while (chain.parent && (ts.isPropertyAccessExpression(chain.parent) || (ts.isCallExpression(chain.parent) && chain.parent.expression === chain))) chain = chain.parent
        const code = chain.getText(source)
        queries.push({ file,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,kind:node.expression.name.text,target:node.arguments[0]?.getText(source),inlineOrgScope:/\.eq\(['"]org_id['"]|\borg_id\s*:/.test(code),code })
      }
      ts.forEachChild(node,visit)
    }
    visit(source)
  }
}
inspect('backend/src'); inspect('frontend/src')
writeFileSync(resolve(root,'docs/phase1/service-role-query-inventory.json'),JSON.stringify({ note:'Static inventory for manual audit; inlineOrgScope is a heuristic, not a security proof. Parent checks, organization primary keys, membership resolution and internal startup operations require separate review.',queries },null,2)+'\n')
console.log(`${queries.length} query call sites inventoried`)
for (const query of queries.filter(query => !query.inlineOrgScope)) console.log(`${query.file}:${query.line} ${query.target} ${query.code.replace(/\s+/g,' ').slice(0,170)}`)
