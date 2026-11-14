import assert from 'node:assert/strict';

// Guard the product's supported EAS entry point; this is not an OS security boundary.
export function assertBuildProfileAllowed(argv,app) {
  if(argv[0]!=='build'||argv.includes('--help')||argv.includes('-h'))return;
  const values=[];
  for(let i=1;i<argv.length;i++) {
    if(argv[i]==='--profile'||argv[i]==='-e') {
      const value=argv[++i];assert.ok(value&&!value.startsWith('-'),'Missing EAS build profile');values.push(value);
    } else if(argv[i].startsWith('--profile=')) values.push(argv[i].slice('--profile='.length));
  }
  assert.ok(values.length<=1,'Specify exactly one build profile');
  const profile=values[0]??'production';
  assert.ok(['development','preview','production'].includes(profile),'Unknown product build profile');
  if(profile!=='production')return;
  const plugin=app.plugins?.find(x=>Array.isArray(x)&&x[0]==='react-native-google-mobile-ads');
  for(const key of ['androidAppId','iosAppId']) {
    const id=plugin?.[1]?.[key];
    assert.ok(typeof id==='string'&&/^ca-app-pub-\d+~\d+$/.test(id)&&!id.startsWith('ca-app-pub-3940256099942544~'),
      'Production build blocked: configure reviewed production AdMob IDs before stage11 release');
  }
}
