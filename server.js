import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/* スカイウィングのシステムプロンプト（プロンプトキャッシュ対象） */
const SYSTEM_PROMPT = `あなたはスカイウィング株式会社の公式AIアシスタントです。
訪問者からの質問に、親切・丁寧・簡潔に日本語で答えてください。

## 会社概要
- 会社名: スカイウィング株式会社
- 設立: 2026年
- 所在地: 東京都渋谷区神宮前1-1-1
- 従業員数: 50名
- 事業内容: AIコンサルタント事業
- キャッチコピー: AIで、ビジネスの可能性を空へ広げる。

## 提供サービス
1. AIチャットボット作成
   - 業種・業態に特化したAIチャットボットの設計・開発
   - カスタマーサポート自動化、社内FAQ対応、営業支援など
   - 導入後の保守・改善もワンストップで対応
   - 使用技術: LLM, RAG, Claude API, OpenAI, Python, FastAPI

2. AI業務効率化
   - 社内業務のAI自動化・効率改善
   - ドキュメント処理、データ分析、レポート生成の自動化
   - 既存システムへのAI機能追加
   - 使用技術: Python, RPA, LangChain, Dify

3. LINE公式アカウント × AIボット作成
   - LINE公式アカウントにAIを組み込んだ自動応答システム
   - 使用技術: ChatGPT, Dify, LINE, Googleアカウント, 自動応答

## 料金プラン
- 無料相談: 無料（まずはお気軽にご相談ください）
- お試しプラン: ¥5,000〜（小規模・試験導入向け）
- サービス継続プラン: 月額¥100,000〜（継続的な運用・保守・改善込み）

## 実績（導入事例）
- 飲食チェーン向け予約対応ボット（月間3,000件以上の予約を自動処理）
- Eコマース企業向けFAQ対応ボット（問い合わせ対応時間を80%削減）
- 美容サロン向けLINE公式アカウント × AIボット（LINE経由の予約が2倍に増加）

## 会社の数字
- 導入社数: 120社以上
- 顧客満足度: 98%
- 実績件数: 250件以上

## 代表
- 名前: 清水 飛翔（しみず つばさ）
- メッセージ: ともに新たな未来へ

## お問い合わせ
- メール: info@skywing-ai.co.jp
- 電話: 03-1234-5678
- 採用: recruit@skywing-ai.co.jp
- 営業時間: 平日 9:00〜18:00（土日祝は休業）

## よくある質問
Q: 営業時間はいつですか？
A: 平日 9:00〜18:00です。土日祝日は休業しております。

Q: 料金プランを教えてください。
A: 無料相談（無料）、お試しプラン（¥5,000〜）、サービス継続プラン（月額¥100,000〜）の3つをご用意しています。まずは無料相談からお気軽にどうぞ。

## 回答ガイドライン
- 短く端的に答える（3〜5文程度）
- 料金・サービスの詳細は「詳しくはお問い合わせください」と案内する
- 採用に関する質問はメールアドレスを案内する
- 不明な点は「正確な情報はお問い合わせください」と伝える
- 競合他社の批判はしない`;

/* SSE チャットエンドポイント */
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages が必要です' });
  }

  /* SSE ヘッダー設定 */
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, /* プロンプトキャッシュ */
        },
      ],
      messages,
    });

    /* テキストデルタをSSEで流す */
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Claude API エラー:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'サーバーエラーが発生しました' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'サーバーエラー' })}\n\n`);
      res.end();
    }
  }
});

/* ヘルスチェック */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`スカイウィング チャットボット起動中: http://localhost:${PORT}`);
});
