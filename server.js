const { default: makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const fs = require('fs');
const Database = require('better-sqlite3');

// 关键字
const KEYWORDS = JSON.parse(fs.readFileSync('./keywords.json','utf8'));

// 数据库初始化
const db = new Database('myguard.db');
db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_by TEXT,
  reported_number TEXT,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  from_number TEXT,
  message TEXT,
  matched_keyword TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const insertAlert = db.prepare('INSERT INTO alerts (chat_id, from_number, message, matched_keyword) VALUES (?,?,?,?)');
const insertReport = db.prepare('INSERT INTO reports (reported_by, reported_number, reason) VALUES (?,?,?)');

// 认证文件
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

(async () => {
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async m => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const sender = msg.pushName || msg.key.participant || from;
      let text = msg.message.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || "";

      // 举报命令
      if (text.startsWith('/report')) {
        const parts = text.split(' ').filter(Boolean);
        const reported_number = parts[1] || null;
        const reason = parts.slice(2).join(' ') || '';
        insertReport.run(sender, reported_number, reason);
        await sock.sendMessage(from, { text: `✅ 已收到举报 ${reported_number}，原因：${reason}` }, { quoted: msg });
        continue;
      }

      // 关键字检测
      let matched = KEYWORDS.find(kw => text.includes(kw));
      if (matched) {
        insertAlert.run(from, sender, text, matched);
        await sock.sendMessage(from, { text: `⚠️ 检测到可疑内容：${matched}\n请谨慎对待！` }, { quoted: msg });
      }
    }
  });

  console.log("🚀 MYguard 已启动，请在 Render 日志中扫码登录 WhatsApp。");
})();
