// Hosted preview read gateway (AWS, behind the local Caddy HTTPS proxy on the same host).
// Same approved config, proof and checks as the local preview gateway; it still listens on 127.0.0.1 only and the
// proxy is the only peer. The client address for rate limiting comes from the proxy's X-Forwarded-For.
import { createPreviewGateway, loadApprovedPreviewConfig } from './cloud-preview-public-read.mjs';

if (process.argv.length !== 2) throw new Error('UNSUPPORTED_ARGUMENT');
const gateway = await createPreviewGateway(loadApprovedPreviewConfig(), { forwardedPeer: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.close());
console.log(JSON.stringify({ component: 'PREVIEW_PUBLIC_READ_HOSTED', productId: 'judoju-news', mode: 'PREVIEW_SYNTHETIC', host: gateway.host, port: gateway.port, privilegedKeyUsed: false }));
