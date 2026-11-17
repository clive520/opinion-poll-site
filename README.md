# 聚點｜班級民意調查

免登入建立與參與調查的繁體中文網站，使用 Firebase Cloud Functions 與 Cloud Firestore 儲存調查及匿名回答，並部署至 GitHub Pages。

## 本機開發

```bash
npm ci
npm run dev
```

Vite 開發伺服器會使用 Firebase API：`https://opinionpollapi-l4atah6fzq-de.a.run.app`。首次部署 Functions 前，本機介面可以載入，但建立與提交調查功能尚未啟用。

## Firebase 資源

- Firebase 專案：`ot-exam-review`
- Firestore 調查集合：`opinion_poll_surveys`
- 每份調查的回答子集合：`opinion_poll_responses`
- 每份調查的統計子集合：`opinion_poll_statistics`
- Cloud Function：`opinionPollApi`（`asia-east1`，`https://opinionpollapi-l4atah6fzq-de.a.run.app`）

上述資源使用本網站專屬名稱；部署 Firebase Functions 時只部署 `opinionPollApi`，不得部署或修改其他網站的函式及 Firestore 規則。

## GitHub Pages

原始碼位於 `main` 分支；公開網站目前由 `gh-pages` 分支根目錄提供，網址為 `https://clive520.github.io/opinion-poll-site/`。Vite 的 base path 設定為 `/opinion-poll-site/`。

## 資料與管理連結

- 任何訪客都可以建立調查或多次送出回答，不要求登入。
- 暱稱為選填，並與該次回答一起保存。
- 建立調查後會產生公開填答網址與管理連結；QR code 只包含公開填答網址。
- 管理連結包含隨機權杖，持有連結者可查看原始回答與管理調查。不要在公開討論或公開程式碼中分享管理連結。
- 不要將服務帳戶金鑰、Firebase 管理權杖或調查回答匯出檔提交至 GitHub。
