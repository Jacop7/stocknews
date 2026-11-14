import {createInstallationHandler} from '../../../../lib/installation-runtime.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handle=createInstallationHandler();
export const GET=handle;
export const POST=handle;
export const OPTIONS=handle;
