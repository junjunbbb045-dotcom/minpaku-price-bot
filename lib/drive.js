import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const __dirname = import.meta.dirname;
const CRED_PATH = path.join(__dirname, '..', 'config', 'client_secret.json');
const TOKEN_PATH = path.join(__dirname, '..', 'config', 'token.json');

export function getOAuthClient() {
  if (!fs.existsSync(CRED_PATH) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      'config/client_secret.json または config/token.json が見つかりません。先に `npm run auth` を実行してください。',
    );
  }

  const keys = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  const { client_id, client_secret } = keys.installed ?? keys.web;
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

  const client = new google.auth.OAuth2(client_id, client_secret);
  client.setCredentials(token);

  // アクセストークン更新時にrefresh_tokenを失わないようマージして保存する
  client.on('tokens', (newTokens) => {
    const merged = { ...token, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return client;
}

export async function uploadMarkdownToDrive(filePath, folderId) {
  const auth = getOAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const fileName = path.basename(filePath);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: 'text/markdown', body: fs.createReadStream(filePath) },
    fields: 'id, name, webViewLink',
  });

  return res.data;
}
