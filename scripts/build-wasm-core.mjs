import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'frontend/wasm/godseye-core.rs');
const output = join(root, 'frontend/public/wasm/godseye-core.wasm');
const args = [source, '--edition=2021', '--target', 'wasm32-unknown-unknown', '--crate-type=cdylib', '-O', '-C', 'opt-level=z', '-C', 'lto=fat', '-C', 'codegen-units=1', '-C', 'panic=abort', '-C', 'strip=symbols', '-o', output];
const localRustc = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'rustc.exe' : 'rustc');
const rustc = existsSync(localRustc) ? localRustc : 'rustc';
const result = spawnSync(rustc, args, { stdio: 'inherit' });
if (result.status !== 0) {
  if (existsSync(output)) console.warn('rustc unavailable; using committed godseye-core.wasm artifact');
  else { console.error('rustc is required to build godseye-core.wasm'); process.exit(1); }
} else console.log('built godseye-core.wasm');
