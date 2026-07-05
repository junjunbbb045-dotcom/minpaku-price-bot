import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const __dirname = import.meta.dirname;
const CRED_PATH = path.join(__dirname, '..', 'config', 'client_secret.json');
const TOKEN_PATH = path.join(__dirname, '..', 'config', 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

if (!fs.existsSync(CRED_PATH)) {
  console.error(`client_secret.json が見つかりません: ${CRED_PATH}`);
  console.error('Google Cloud Console で作成したOAuthクライアント(デスクトップアプリ)のJSONをここに配置してください。');
  process.exit(1);
}

const keys = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const { client_id, client_secret } = keys.installed ?? keys.web;

let oauth2Client;

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }
  const reqUrl = new URL(req.url, 'http://127.0.0.1');
  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('認証に失敗しました。ターミナルを確認してください。');
    console.error('認証エラー:', error || 'codeが見つかりません');
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('認証が完了しました。このタブを閉じてターミナルに戻ってください。');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`トークンを保存しました: ${TOKEN_PATH}`);
  } catch (err) {
    console.error('トークン取得に失敗しました:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('以下のURLをブラウザで開き、junjun.bbb.045@gmail.com でログインして許可してください:\n');
  console.log(authUrl);
  console.log('\n許可後、自動的にこのターミナルに戻ります。');
});
