/**
 * On-demand stock analysis batch runner.
 *
 * Creates N "once" tasks in the NanoClaw scheduler. The scheduler picks them
 * up immediately and runs each one in an isolated container. Results are
 * delivered to your Telegram chat.
 *
 * Usage:
 *   npx tsx scripts/analyze-stocks.ts [count] [chat_jid]
 *   npx tsx scripts/analyze-stocks.ts --ticker TICKER [chat_jid]
 *
 * Examples:
 *   npx tsx scripts/analyze-stocks.ts          # 5 stocks, default chat
 *   npx tsx scripts/analyze-stocks.ts 3        # 3 stocks
 *   npx tsx scripts/analyze-stocks.ts 5 tg:1497198698  # different chat
 *   npx tsx scripts/analyze-stocks.ts --ticker FIX     # specific ticker
 *
 * To convert to recurring: change schedule_type to 'cron' or 'interval'.
 */
import { randomUUID } from 'crypto';
import path from 'path';
import Database from 'better-sqlite3';

const STORE_DIR = path.resolve(process.cwd(), 'store');
const DB_PATH = path.join(STORE_DIR, 'messages.db');

const DEFAULT_CHAT_JID = 'tg:1497198698'; // DG — user's personal chat

// Parse --ticker flag
const tickerFlagIdx = process.argv.indexOf('--ticker');
const forcedTicker = tickerFlagIdx !== -1 ? process.argv[tickerFlagIdx + 1]?.toUpperCase() : null;

// When --ticker is used, count is always 1; otherwise read from argv[2]
const count = forcedTicker ? 1 : parseInt(process.argv[2] || '5', 10);
const chatJid = forcedTicker
  ? (process.argv[tickerFlagIdx + 2] || DEFAULT_CHAT_JID)
  : (process.argv[3] || DEFAULT_CHAT_JID);
const groupFolder = chatJid.replace('tg:', 'tg_');

if (!forcedTicker && (isNaN(count) || count < 1 || count > 20)) {
  console.error('Count must be between 1 and 20');
  process.exit(1);
}

function buildPrompt(ticker?: string): string {
  const tickerOverride = ticker
    ? `The stock to analyze is ${ticker} — ignore the COMPANY TO ANALYZE in the API response and use ${ticker} instead.`
    : '';

  return `Use Bash (curl) to fetch the analysis instructions and the stock to analyze:

curl 'https://picks.taxar.eu/sections/api/ai-rec/?action=get-recommendation'

${tickerOverride}

Follow the instructions in the API response exactly — including all research requirements, the rating framework, and the output JSON format.

Once you have your recommendation JSON, POST it to:
curl -X POST 'https://picks.taxar.eu/sections/api/ai-rec/?action=save-recommendation' -H 'Content-Type: application/json' -d '<your JSON>'

Verify the POST returned {"status":"success"} before finishing.
Return: "[TICKER] → [RATING] ([CONFIDENCE]%) — [one sentence reason]"`;
}

const db = new Database(DB_PATH);

const now = new Date();
let created = 0;

const containerConfig = JSON.stringify({ maxTurns: 35 });

for (let i = 0; i < count; i++) {
  db.prepare(`
    INSERT INTO scheduled_tasks
      (id, group_folder, chat_jid, prompt, script, container_config, schedule_type, schedule_value,
       context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, 'once', '0', 'isolated', ?, 'active', ?)
  `).run(
    randomUUID(),
    groupFolder,
    chatJid,
    buildPrompt(forcedTicker ?? undefined),
    containerConfig,
    now.toISOString(),
    now.toISOString(),
  );
  created++;
}

db.close();

console.log(`✓ Queued ${created} stock analysis task(s) → ${chatJid}`);
console.log(`  The scheduler will pick them up within ${Math.ceil(60 / 1)} minute.`);
