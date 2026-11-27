import type { NextConfig } from 'next';
import path from 'node:path';
// The online image (CLOUD11-online) builds a self-contained server; local builds stay unchanged.
const standalone=process.env.JUDOJU_ADMIN_STANDALONE==='1';
const config:NextConfig={transpilePackages:['@judoju/contracts'],
  ...(standalone?{output:'standalone' as const,outputFileTracingRoot:path.join(__dirname,'../..'),poweredByHeader:false}:{})};
export default config;
