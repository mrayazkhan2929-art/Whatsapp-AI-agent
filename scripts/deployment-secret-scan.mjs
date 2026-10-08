import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean)
const findings=[]
const patterns=[/\bgsk_[A-Za-z0-9_-]{20,}\b/g,/\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}\b/g,/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{25,}\b/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g]
for(const file of new Set(files)){
 const body=readFileSync(file)
 if(body.includes(0))continue
 body.toString('utf8').split(/\r?\n/).forEach((line,index)=>{if(patterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(line)}))findings.push({file,line:index+1})})
}
console.log(JSON.stringify({files:new Set(files).size,findings},null,2))
if(findings.length)process.exitCode=1
