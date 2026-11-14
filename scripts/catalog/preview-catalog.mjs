import { readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { parseCatalog,cellHash } from './parse-catalog.mjs';
const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
export function createPreview({input,registry,output}){
  const folder=path.join(root,'.local-data/catalog-previews');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.json$/.test(output)||output.includes('..'))throw new Error('PREVIEW_BASENAME_REQUIRED');
  const read=p=>{const full=path.resolve(root,p);if(lstatSync(full).isSymbolicLink()||realpathSync(full)!==full||lstatSync(full).size>2*1024*1024)throw new Error('UNSAFE_OR_OVERSIZED_INPUT');return readFileSync(full);};
  const bytes=read(input),registryBytes=read(registry);
  const report=parseCatalog(JSON.parse(bytes.toString('utf8')),JSON.parse(registryBytes.toString('utf8')),{sourceSha256:cellHash(bytes)});
  // Validate each ancestor to prevent junction escapes, including the ignored root.
  for(const p of [path.join(root,'.local-data'),folder]){if(!existsSync(p))mkdirSync(p);if(lstatSync(p).isSymbolicLink()||realpathSync(p)!==p)throw new Error('UNSAFE_OUTPUT_DIRECTORY');}
  const destination=path.join(folder,output);writeFileSync(destination,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  return {destination,summary:report.summary,status:report.status,importable:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),allowed=new Set(['--input','--registry','--output']),options={};
  for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw new Error('EXPLICIT_OFFLINE_OPTIONS_REQUIRED');options[args[i]]=args[i+1];}
  if(Object.keys(options).length!==3)throw new Error('USAGE: --input FILE --registry FILE --output NEW_BASENAME.json');
  console.log(JSON.stringify(createPreview({input:options['--input'],registry:options['--registry'],output:options['--output']})));
}
