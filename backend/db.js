const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../dxy_trading.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,           -- 'BUY' or 'SELL'
    entry_price REAL NOT NULL,
    exit_price REAL,
    quantity REAL NOT NULL DEFAULT 1,
    stop_loss REAL NOT NULL,
    take_profit_1 REAL NOT NULL,
    take_profit_2 REAL NOT NULL,
    status TEXT DEFAULT 'OPEN',     -- 'OPEN', 'CLOSED', 'STOPPED', 'TP1', 'TP2'
    pnl REAL DEFAULT 0,
    confluence_score INTEGER,
    entry_reason TEXT,              -- JSON string of which factors triggered
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    ist_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL UNIQUE,
    open REAL, high REAL, low REAL, close REAL, volume REAL
  );

  CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS cot_data (
    week_date TEXT PRIMARY KEY,
    net_noncommercial INTEGER,
    long_noncommercial INTEGER,
    short_noncommercial INTEGER,
    change_net INTEGER
  );

  CREATE TABLE IF NOT EXISTS news_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time TEXT,
    currency TEXT,
    impact TEXT,         -- 'HIGH', 'MEDIUM', 'LOW'
    title TEXT,
    fetched_at TEXT
  );

  CREATE TABLE IF NOT EXISTS balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    usd_balance REAL NOT NULL
  );
`);

// Initialize virtual paper balance to $50.0 USD if empty
const balanceCount = db.prepare("SELECT COUNT(*) as count FROM balance").get().count;
if (balanceCount === 0) {
  db.prepare("INSERT INTO balance (usd_balance) VALUES (?)").run(50.0);
}

// Prepare database statements for high performance
const insertCandleStmt = db.prepare(`
  INSERT OR REPLACE INTO candles (timestamp, open, high, low, close, volume)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertCOTStmt = db.prepare(`
  INSERT OR REPLACE INTO cot_data (week_date, net_noncommercial, long_noncommercial, short_noncommercial, change_net)
  VALUES (?, ?, ?, ?, ?)
`);

const insertTradeStmt = db.prepare(`
  INSERT INTO trades (action, entry_price, stop_loss, take_profit_1, take_profit_2, quantity, confluence_score, entry_reason, status, opened_at, ist_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getOpenTradesStmt = db.prepare("SELECT * FROM trades WHERE status = 'OPEN'");
const updateTradeSLStmt = db.prepare("UPDATE trades SET stop_loss = ? WHERE id = ?");
const closeTradeStmt = db.prepare("UPDATE trades SET exit_price = ?, status = ?, pnl = ?, closed_at = ? WHERE id = ?");
const getAllTradesStmt = db.prepare("SELECT * FROM trades ORDER BY opened_at DESC");
const getCandlesStmt = db.prepare("SELECT * FROM candles ORDER BY timestamp DESC LIMIT ?");
const getLatestCOTStmt = db.prepare("SELECT * FROM cot_data ORDER BY week_date DESC LIMIT 1");
const getBotStateStmt = db.prepare("SELECT value FROM bot_state WHERE key = ?");
const setBotStateStmt = db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)");
const getLatestBalanceStmt = db.prepare("SELECT usd_balance FROM balance ORDER BY id DESC LIMIT 1");
const insertBalanceStmt = db.prepare("INSERT INTO balance (usd_balance) VALUES (?)");

const dbOperations = {
  // Candle operations in an efficient transaction
  insertCandles: db.transaction((candles) => {
    for (const c of candles) {
      insertCandleStmt.run(c.timestamp, c.open, c.high, c.low, c.close, c.volume);
    }
  }),

  getCandles: (limit = 100) => {
    const rows = getCandlesStmt.all(limit);
    return rows.reverse(); // Return oldest first for charting packages
  },

  // COT operations
  insertCOT: (cot) => {
    if (!cot) return;
    insertCOTStmt.run(cot.week_date, cot.net_noncommercial, cot.long_noncommercial, cot.short_noncommercial, cot.change_net);
  },

  getLatestCOT: () => {
    return getLatestCOTStmt.get();
  },

  // Trade operations
  insertTrade: (trade) => {
    const info = insertTradeStmt.run(
      trade.action,
      trade.entry_price,
      trade.stop_loss,
      trade.take_profit_1,
      trade.take_profit_2,
      trade.quantity,
      trade.confluence_score,
      trade.entry_reason,
      trade.status,
      trade.opened_at,
      trade.ist_date
    );
    return info.lastInsertRowid;
  },

  getOpenTrades: () => {
    return getOpenTradesStmt.all();
  },

  updateTradeStopLoss: (id, newSL) => {
    updateTradeSLStmt.run(newSL, id);
  },

  closeTrade: (id, exitPrice, status, pnl) => {
    closeTradeStmt.run(exitPrice, status, pnl, new Date().toISOString(), id);
  },

  getAllTrades: () => {
    return getAllTradesStmt.all();
  },

  getTodaysTrades: () => {
    const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    // Match date part in format (e.g. DD/MM/YYYY or YYYY-MM-DD depending on locale)
    const all = getAllTradesStmt.all();
    // Filter out manual UI trades so they don't count as automated bot trades
    return all.filter(t => t.ist_date && t.ist_date.includes(today) && !(t.entry_reason && t.entry_reason.includes('manual_trade')));
  },

  // State Persistence
  saveBotState: (key, val) => {
    setBotStateStmt.run(key, JSON.stringify(val));
  },

  getBotState: (key) => {
    const row = getBotStateStmt.get(key);
    return row ? JSON.parse(row.value) : null;
  },

  // Simulated Balance Management
  getLatestBalance: () => {
    const row = getLatestBalanceStmt.get();
    return row ? row.usd_balance : 50.0;
  },

  updateBalance: (usdBalance) => {
    insertBalanceStmt.run(usdBalance);
  },

  // Admin Reset
  clearAllData: () => {
    db.exec(`
      DELETE FROM trades;
      DELETE FROM bot_state;
      DELETE FROM balance;
      INSERT INTO balance (usd_balance) VALUES (50.0);
    `);
  }
};

module.exports = dbOperations;
