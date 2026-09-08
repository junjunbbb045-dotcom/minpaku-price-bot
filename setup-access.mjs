// Cloudflare Access でダッシュボード(Pages)を許可メールアドレスのみ閲覧可にする。
// 許可リストは config/dashboard-viewers.json。変更したら `npm run access` で再適用する。
import fs from 'node:fs';
import path from 'node:path';

const __dirname = import.meta.dirname;
const ENV_PATH = path.join(__dirname, 'config', 'cloudflare.env');
const VIEWERS_PATH = path.join(__dirname, 'config', 'dashboard-viewers.json');
const POLICY_NAME = 'allowed-users';

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv(ENV_PATH);
const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_ACCESS_TOKEN: token, CLOUDFLARE_PAGES_HOST: host } = env;
if (!accountId || !token || !host) {
  console.error('config/cloudflare.env に CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_ACCESS_TOKEN / CLOUDFLARE_PAGES_HOST が必要です');
  process.exit(1);
}

const viewers = JSON.parse(fs.readFileSync(VIEWERS_PATH, 'utf8'));
const emails = (viewers.allowedEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
if (emails.length === 0) {
  console.error('config/dashboard-viewers.json の allowedEmails が空です');
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access`;

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`${method} ${pathname} failed: ${msg}`);
  }
  return json.result;
}

const appBody = {
  name: viewers.applicationName ?? 'minpaku-dashboard',
  type: 'self_hosted',
  domain: host,
  // プレビューデプロイ(<hash>.<project>.pages.dev)も同じ制限をかける
  self_hosted_domains: [host, `*.${host}`],
  session_duration: viewers.sessionDuration ?? '24h',
  app_launcher_visible: false,
  auto_redirect_to_identity: false,
};

const apps = await api('GET', '/apps');
let app = apps.find((a) => a.name === appBody.name);
if (app) {
  app = await api('PUT', `/apps/${app.id}`, appBody);
  console.log(`Accessアプリを更新: ${app.name} (${app.domain})`);
} else {
  app = await api('POST', '/apps', appBody);
  console.log(`Accessアプリを作成: ${app.name} (${app.domain})`);
}

const policyBody = {
  name: POLICY_NAME,
  decision: 'allow',
  precedence: 1,
  include: emails.map((email) => ({ email: { email } })),
  exclude: [],
  require: [],
};

const policies = await api('GET', `/apps/${app.id}/policies`);
const existing = policies.find((p) => p.name === POLICY_NAME);
if (existing) {
  await api('PUT', `/apps/${app.id}/policies/${existing.id}`, policyBody);
  console.log(`ポリシーを更新: ${POLICY_NAME}`);
} else {
  await api('POST', `/apps/${app.id}/policies`, policyBody);
  console.log(`ポリシーを作成: ${POLICY_NAME}`);
}

console.log(`許可メールアドレス (${emails.length}件):`);
for (const e of emails) console.log(`  - ${e}`);
console.log(`公開URL: https://${host}/`);
