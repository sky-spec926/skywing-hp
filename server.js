import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';

const app = express();

/* ⚠️ 誰でも叩ける公開APIなので、自分のサイトからだけ受ける */
const ALLOWED = [
  'https://sky-spec926.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED.includes(origin)),
}));
app.use(express.json({ limit: '64kb' }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ──────────────────────────────────────────────
   使いすぎの防止
   🔴 公開URLに置くと誰でも叩ける＝APIの請求が青天井になる。
      Railwayで動かしていたときはここが無かった。
   ────────────────────────────────────────────── */
const LIMIT_PER_MIN = 5;     // 同じ人から1分あたり
const LIMIT_PER_DAY = 80;    // 同じ人から1日あたり
const LIMIT_TOTAL_DAY = 300; // サイト全体で1日あたり

const hits = new Map();      // IP → { min: [時刻...], day: 件数, dayKey: 'YYYY-MM-DD' }
let total = { count: 0, dayKey: '' };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 上限を超えていたら理由を返す。大丈夫なら null */
function checkLimit(ip) {
  const now = Date.now();
  const key = todayKey();

  if (total.dayKey !== key) total = { count: 0, dayKey: key };
  if (total.count >= LIMIT_TOTAL_DAY) {
    return '本日の利用が上限に達しました。明日またお試しください。';
  }

  const rec = hits.get(ip) || { min: [], day: 0, dayKey: key };
  if (rec.dayKey !== key) { rec.day = 0; rec.dayKey = key; }
  rec.min = rec.min.filter((t) => now - t < 60_000);

  if (rec.min.length >= LIMIT_PER_MIN) {
    hits.set(ip, rec);
    return '少し間を空けてからお試しください。';
  }
  if (rec.day >= LIMIT_PER_DAY) {
    hits.set(ip, rec);
    return '本日の利用が上限に達しました。明日またお試しください。';
  }

  rec.min.push(now);
  rec.day += 1;
  hits.set(ip, rec);
  total.count += 1;
  return null;
}

/* 古い記録を1時間ごとに捨てる（メモリを増やし続けないため） */
setInterval(() => {
  const key = todayKey();
  for (const [ip, rec] of hits) {
    if (rec.dayKey !== key && rec.min.length === 0) hits.delete(ip);
  }
}, 60 * 60 * 1000).unref?.();

/* ──────────────────────────────────────────────
   このボットが何者か
   ⚠️ 以前は「スカイウィング株式会社（架空）」の案内役になっていた。
      住所も従業員数も実在しないのに、本物のように答えてしまう作りだった。
      ポートフォリオとして見せるものなので、**本人の案内役**に書き直した。
   ────────────────────────────────────────────── */
const SYSTEM_PROMPT = `あなたは、シミズツバサ（個人で活動するAIエンジニア）のサイトに置かれたアシスタントです。
訪問者の質問に、親切・簡潔に日本語で答えてください。

## シミズツバサについて
- 製造業（品質保証）で働きながら、AIを使った制作と業務自動化を個人で行っています
- 「作って、公開するところまで」を一人でやっています

## 作ったもの（すべて実物があります）
1. 紙・PDFをAIで読み取って表に起こすツール
   - Googleドライブに紙の写真を入れると、AIが読み取ってスプレッドシートに起こします
   - 読み取れない項目は推測せず「要確認」に回します（間違いが黙って混ざらない作り）
   - 動画: https://youtu.be/KEiQb9RcTXU
2. 報告の集計と督促を自動化するツール
   - 締め時刻に自動集計し、未報告の拠点へ督促を送ります
   - 同じ締め回に二重送信しない／1件失敗しても止まらない
   - 動画: https://youtu.be/5L8uJKrt9LM
3. 環境音BGMチャンネル「眠りの音」
   - 雨・焚き火・虫の声などをPythonでゼロから合成。3か月で106本を公開
   - https://www.youtube.com/@nemurinooto-bgm
4. 自作音源の素材販売（著作権フリー・6商品24テーマ）
   - https://nemurinooto.booth.pm/
5. AIと連携するタスク管理アプリ
   - https://sky-spec926.github.io/skywing-hp/tasks.html
6. このチャットボット自体（Claude API ＋ ストリーミング応答）

## できること（お受けできる相談）
- 繰り返している手作業を仕組みに置きかえること（集計・転記・通知・督促など）
- 紙やPDFのデータ化
- 問い合わせ対応のチャットボット
- Googleスプレッドシート／Google Apps Script での自動化

## 使っている技術
Python（NumPy / Pillow）、Google Apps Script、Claude API、Node.js、ffmpeg、Git

## 答え方のルール
- 日本語で、3〜5行程度にまとめる
- 実物があるものは、URLを添えて案内する
- 🔴 **分からないことは「分かりません」と答える。推測で埋めない**
- 🔴 **料金・納期・契約の条件は、この場では答えない。**
  「内容によって変わるので、お問い合わせください」と伝える
- 会社ではなく個人で活動していることを、聞かれたら正直に伝える
- 他社やほかの人の批判はしない`;

/* SSE チャットエンドポイント */
app.post('/api/chat', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .toString().split(',')[0].trim();

  const over = checkLimit(ip);
  if (over) return res.status(429).json({ error: over });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages が必要です' });
  }

  /* 長い履歴や長文を投げられないようにする（費用と応答時間の両方のため） */
  const trimmed = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 1000),
  }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = client.messages.stream({
      /* ⚠️ 公開ボットなので、速くて安いモデルを使う */
      model: 'claude-haiku-5-5',
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, /* プロンプトキャッシュ */
        },
      ],
      messages: trimmed,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('ストリームエラー:', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: '応答の途中で問題が起きました' })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Claude API エラー:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'サーバーエラー' })}\n\n`);
      res.end();
    }
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`チャットボット起動中: http://localhost:${PORT}`);
});
