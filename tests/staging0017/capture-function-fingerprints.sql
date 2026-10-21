-- HASHES/SIGNATURES ONLY, no source returned. SQL token fingerprint keeps
-- string literals, quoted identifiers and token boundaries intact, while
-- excluding comments/format whitespace. Dollar-literal bodies are flagged
-- and require separate review; never trust this lexer for those functions.
begin transaction read only;
with f as (
 select p.oid,n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as args,p.prosrc
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','authorization_private') and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
)
select schema,name,args,
 prosrc ~ '\$[A-Za-z_0-9]*\$' as has_dollar_literals,
 (select md5(coalesce(string_agg(m[1],chr(31) order by ord),''))
  from regexp_matches(prosrc,
  $lex$(--[^\n]*|/\*(?:[^*]|\*(?!/))*\*/|[eE]'(?:''|\\.|[^'\\])*'|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[+\-*/<>=~!@#%^&|`?]+|[^[:space:]])$lex$,
  'g') with ordinality as tokens(m,ord)
  where m[1] !~ '^(--|/\*)') as token_md5
from f order by schema,name,args;
rollback;
