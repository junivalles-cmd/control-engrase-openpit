import {createHash} from 'node:crypto';
export const digest=s=>createHash('md5').update(s).digest('hex');
export const normalized=s=>s.replace(/\r\n/g,'\n').trim();
// Statement lexer: preserves strings/dollar bodies and ignores comment
// semicolons. It never executes the source while looking for functions.
export function statements(sql){
 const out=[];let start=0,quote=null,dollar=null,line=false,block=0;
 for(let i=0;i<sql.length;i++){
  const c=sql[i],n=sql[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(block){if(c==='/'&&n==='*'){block++;i++;}else if(c==='*'&&n==='/'){block--;i++;}continue;}
  if(dollar){if(sql.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
  if(quote){if(c===quote){if(n===quote)i++;else quote=null;}continue;}
  if(c==='-'&&n==='-'){line=true;i++;continue;}
  if(c==='/'&&n==='*'){block=1;i++;continue;}
  if(c==="'"||c==='"'){quote=c;continue;}
  if(c==='$'){const m=sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);if(m){dollar=m[0];i+=dollar.length-1;continue;}}
  if(c===';'){out.push(sql.slice(start,i+1));start=i+1;}
 }
 if(sql.slice(start).trim())out.push(sql.slice(start));return out;
}
export const withoutLeadingComments=s=>s.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'');
export function functionsIn(sql,file){
 return statements(sql).flatMap(statement=>{
  const clean=withoutLeadingComments(statement);
  const name=clean.match(/^create\s+(?:or\s+replace\s+)?function\s+([a-z_][\w.]*)\s*\(/i);
  if(!name)return [];
  const body=clean.match(/\bas\s+(\$[A-Za-z_0-9]*\$)([\s\S]*?)\1/i);
  if(!body)return [];
  const full=name[1].includes('.')?name[1]:'public.'+name[1];
  return [{file,name:full,statement:clean,body:body[2],hash:digest(normalized(body[2])),noWhitespaceHash:digest(body[2].replace(/\s/g,''))}];
 });
}
export const qi=s=>'"'+String(s).replaceAll('"','""')+'"';
export const ql=s=>"'"+String(s).replaceAll("'","''")+"'";
export function canonical(obj){if(Array.isArray(obj))return obj.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(obj&&typeof obj==='object')return Object.fromEntries(Object.keys(obj).sort().map(k=>[k,canonical(obj[k])]));return obj;}
export function catalogDifferences(expected,actual,referenceTokens,actualTokens){
 const differences=[];
 const classes=['tables','columns','constraints','indexes','policies','table_grants','function_grants','schema_grants','matrix','bucket','support_control','release_state','types','sequences','views'];
 for(const type of classes)if(JSON.stringify(canonical(actual[type]))!==JSON.stringify(canonical(expected[type])))differences.push({class:type,expected:canonical(expected[type]),actual:canonical(actual[type])});
 const meta=f=>{const {source_md5,no_whitespace_md5,...m}=f;return m;};
 if(JSON.stringify(canonical(actual.functions.map(meta)))!==JSON.stringify(canonical(expected.functions.map(meta))))differences.push({class:'function_metadata',expected:expected.functions.map(meta),actual:actual.functions.map(meta)});
 if(JSON.stringify(canonical(actualTokens))!==JSON.stringify(canonical(referenceTokens)))differences.push({class:'function_tokens',expected:referenceTokens,actual:actualTokens});
 return differences;
}
