/**
 * CLI config + credential storage.
 *
 * Config (non-sensitive): stored in OS config dir via `conf`.
 * Credentials (token): stored in OS keychain via `keytar`.
 *
 * Local project config (`sentinel.config.json`) is read from cwd.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Type-only: erased at compile time, so `conf` is still loaded lazily below and
// costs nothing at startup.
import type Conf from 'conf';

let _conf: Conf<SentinelConf> | null = null;

interface SentinelConf {
  apiUrl?: string;
}

export interface ProjectConfig {
  apiUrl: string;
  project: string;
  defaultEnv?: string;
}

const CONFIG_FILE = 'sentinel.config.json';
const KEYTAR_SERVICE = 'sentinel-cli';
const KEYTAR_ACCOUNT = 'token';

async function getConf(): Promise<Conf<SentinelConf>> {
  if (!_conf) {
    const { default: Conf } = await import('conf');
    _conf = new Conf<SentinelConf>({ projectName: 'sentinel-cli' });
  }
  return _conf;
}

// ─── Keychain ───────────────────────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  try {
    const keytar = await import('keytar');
    await keytar.default.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, token);
  } catch {
    // Fallback: store in conf (less secure)
    const conf = await getConf();
    (conf as unknown as { set: (k: string, v: string) => void }).set('_token', token);
  }
}

export async function loadToken(): Promise<string | null> {
  // Check SENTINEL_API_KEY env var first (for CI/CD)
  if (process.env['SENTINEL_API_KEY']) {
    return process.env['SENTINEL_API_KEY'];
  }

  try {
    const keytar = await import('keytar');
    return await keytar.default.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    const conf = await getConf();
    return (conf as unknown as { get: (k: string) => string | undefined }).get('_token') ?? null;
  }
}

export async function deleteToken(): Promise<void> {
  try {
    const keytar = await import('keytar');
    await keytar.default.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    const conf = await getConf();
    (conf as unknown as { delete: (k: string) => void }).delete('_token');
  }
}

// ─── API URL ─────────────────────────────────────────────────────────────────

export async function saveApiUrl(url: string): Promise<void> {
  const conf = await getConf();
  conf.set('apiUrl', url);
}

export async function loadApiUrl(): Promise<string | null> {
  // Env var takes precedence
  if (process.env['SENTINEL_API_URL']) {
    return process.env['SENTINEL_API_URL'];
  }

  // Try local project config first
  const localCfg = loadProjectConfig();
  if (localCfg?.apiUrl) return localCfg.apiUrl;

  // Fall back to global conf
  const conf = await getConf();
  return conf.get('apiUrl') ?? null;
}

// ─── Project config (sentinel.config.json) ──────────────────────────────────

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  try {
    const cfgPath = resolve(cwd, CONFIG_FILE);
    const raw = readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

export function saveProjectConfig(cfg: ProjectConfig, cwd: string = process.cwd()): void {
  const cfgPath = resolve(cwd, CONFIG_FILE);
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
