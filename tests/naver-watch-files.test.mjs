// Naver watch PC scripts (docs/sector-news-plan.md §3.2, §3.5): the upload uses only the dedicated key with no
// fallback, the operations key is refused; the PowerShell scripts parse; receive.sh keeps its limits. Windows only
// for the PowerShell parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('../scripts/ops/naver-watch/', import.meta.url);
const ps = script => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true });
const win = process.platform === 'win32';

test('upload arguments: dedicated key only, no agent or password fallback, pinned host key; operations key refused', { skip: !win }, () => {
  const lib = new URL('upload-args.ps1', dir).pathname.replace(/^\//, '').replace(/%20/g, ' ');
  const libPath = decodeURIComponent(lib);
  const keys = 'C:\\Users\\x\\AppData\\Local\\judoju\\naver-watch\\keys';
  const ok = ps(`. '${libPath}'; (Get-UploadArgs -Key '${keys}\\upload-ed25519' -KnownHosts '${keys}\\known_hosts' -KeysDir '${keys}' -Server 'ubuntu@52.79.247.25') -join ' '`);
  assert.equal(ok.status, 0, ok.stderr);
  for (const flag of ['IdentitiesOnly=yes', 'IdentityAgent=none', 'BatchMode=yes', 'PasswordAuthentication=no', 'StrictHostKeyChecking=yes', 'HostKeyAlgorithms=ssh-ed25519']) assert.ok(ok.stdout.includes(flag), flag);
  const ops = ps(`. '${libPath}'; Get-UploadArgs -Key 'C:\\repo\\.local-data\\collector-cloud\\ssh-lightsail\\judoju-collector-ed25519' -KnownHosts 'x' -KeysDir '${keys}' -Server 'ubuntu@1.2.3.4'`);
  assert.notEqual(ops.status, 0); assert.match(ops.stderr + ops.stdout, /UPLOAD_KEY_OUTSIDE_KEYS_DIR/);
  const inside = ps(`. '${libPath}'; Get-UploadArgs -Key '${keys}\\judoju-collector-ed25519' -KnownHosts 'x' -KeysDir '${keys}' -Server 'ubuntu@1.2.3.4'`);
  assert.match(inside.stderr + inside.stdout, /UPLOAD_KEY_NOT_THE_UPLOAD_KEY|OPERATIONS_KEY_REFUSED/);
  const other = ps(`. '${libPath}'; Get-UploadArgs -Key '${keys}\\other-key' -KnownHosts 'x' -KeysDir '${keys}' -Server 'ubuntu@1.2.3.4'`);
  assert.match(other.stderr + other.stdout, /UPLOAD_KEY_NOT_THE_UPLOAD_KEY/);
  const server = ps(`. '${libPath}'; Get-UploadArgs -Key '${keys}\\upload-ed25519' -KnownHosts 'x' -KeysDir '${keys}' -Server 'root@evil; rm'`);
  assert.match(server.stderr + server.stdout, /UPLOAD_SERVER_INVALID/);
});

test('the PowerShell scripts parse', { skip: !win }, () => {
  for (const f of ['capture.ps1', 'ocr.ps1', 'upload.ps1', 'upload-args.ps1', 'install.ps1']) {
    const p = decodeURIComponent(new URL(f, dir).pathname.replace(/^\//, ''));
    const r = ps(`$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${p}',[ref]$null,[ref]$e); $e.Count`);
    assert.equal(r.stdout.trim(), '0', f + ' ' + r.stderr);
  }
});

test('capture: no reload, navigation, login or random timing; work files deleted in finally; single instance', () => {
  const text = readFileSync(new URL('capture.ps1', dir), 'utf8');
  assert.ok(!/Get-Random|F5|Refresh|Navigate|SendKeys|password/i.test(text));
  assert.match(text, /finally \{ Remove-Item -LiteralPath \$round -Recurse -Force/);
  assert.match(text, /Mutex\(\$false, 'Local\\JudojuNaverWatchCapture'\)/);
  assert.match(text, /Remove-Item -LiteralPath \$png -Force/, 'screenshots deleted right after OCR');
});

test('receive.sh: 32 KiB cap, no links, atomic rename, no arguments used', () => {
  const text = readFileSync(new URL('receive.sh', dir), 'utf8');
  assert.match(text, /head -c 32769/); assert.match(text, /-le 32768/);
  assert.match(text, /\[ ! -L "\$target" \]/); assert.match(text, /mv -f "\$tmp" "\$target"/);
  assert.ok(!/\$1|\$@|SSH_ORIGINAL_COMMAND\b(?! and)/.test(text.replace(/^#.*$/gm, '')));
});
