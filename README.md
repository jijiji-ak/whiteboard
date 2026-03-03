# Online Whiteboard

リアルタイムコラボレーション対応のオンラインホワイトボードです。

## 構成

```
whiteboard/
├── render.yaml             # Render デプロイ設定
├── server/   # Node.js + Express + Socket.io  → Render (無料)
└── client/   # React + Vite + Socket.io-client → Vercel (無料)
```

## ローカル開発

### 1. サーバー起動

```bash
cd server
npm install
npm run dev   # nodemon で起動 (port 3001)
```

### 2. クライアント起動

```bash
cd client
npm install
# .env.local を作成
echo "VITE_SERVER_URL=http://localhost:3001" > .env.local
npm run dev   # http://localhost:5173 で起動
```

---

## Render へのデプロイ (Server) — 無料

> **注意:** Render の無料プランは 15 分間アクセスがないとサーバーがスリープします。
> 次のアクセス時に再起動（約 30 秒）が発生します。

### 方法 A: render.yaml を使った自動設定（推奨）

1. このリポジトリを GitHub に push する
2. [Render ダッシュボード](https://dashboard.render.com/) → **New → Blueprint**
3. リポジトリを選択して Deploy
4. Vercel のデプロイ後に環境変数 `CLIENT_ORIGIN` を設定する（下記参照）

### 方法 B: ダッシュボードから手動設定

1. Render ダッシュボード → **New → Web Service**
2. リポジトリを接続
3. 以下を設定:

| 項目 | 値 |
|------|----|
| Root Directory | `server` |
| Environment | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | `Free` |

4. **Environment Variables** に追加:

| Key | Value |
|-----|-------|
| `CLIENT_ORIGIN` | Vercel の URL（後で設定） |
| `NODE_ENV` | `production` |

デプロイ後の URL: `https://whiteboard-server.onrender.com`（自動で決まる）

---

## Vercel へのデプロイ (Client) — 無料

### 前提条件
- Render サーバーのデプロイが完了していること

### GitHub 連携（推奨）

1. GitHub にリポジトリを push
2. [Vercel ダッシュボード](https://vercel.com/dashboard) → **Add New → Project**
3. リポジトリをインポート
4. **Root Directory** を `client` に設定
5. **Environment Variables** に追加:

| Key | Value |
|-----|-------|
| `VITE_SERVER_URL` | `https://whiteboard-server.onrender.com` |

6. **Deploy**

### CLI でのデプロイ

```bash
cd client
npm install -g vercel
vercel
# Framework: Vite
# Root Directory: client
vercel env add VITE_SERVER_URL
# 値: https://whiteboard-server.onrender.com
vercel --prod
```

### デプロイ後: Render の CORS 設定を更新

Vercel の URL が確定したら、Render ダッシュボードで `CLIENT_ORIGIN` を更新:

```
CLIENT_ORIGIN = https://your-app.vercel.app
```

---

## 機能

- リアルタイム同時描画（複数ユーザー対応）
- ペン / 消しゴム ツール
- プリセット 10 色 + カスタムカラーピッカー
- ストロークサイズ調整（1〜40px）
- 全員のボードを一括クリア
- 接続中ユーザー数表示
- 新規参加時に既存の描画を再現
- タッチデバイス（スマートフォン・タブレット）対応
