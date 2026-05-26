const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
global.wss = wss; // Globally available for broadcasting updates

const db = require('./db');
const { botState, initBot } = require('./tradingBot');
const executionEngine = require('./executionEngine');

// Serve compiled React build in production mode
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ==================== API ENDPOINTS ====================

// 1. Bot status info
app.get('/api/bot/status', (req, res) => {
  const todayTrades = db.getTodaysTrades();
  const todayTrade = todayTrades.length > 0 ? todayTrades[0] : null;
  
  res.json({
    bot: {
      isRunning: botState.enabled,
      priceDataPoints: 50,
      activeTrades: db.getOpenTrades().length,
      lastAnalysisTime: botState.lastAnalysis,
      currentScore: botState.currentScore || 0,
      currentSignal: botState.currentSignal || 'NEUTRAL',
      dailyTradeTaken: botState.dailyTradeCount > 0,
      dailyLossCount: botState.consecutiveLosses,
      circuitBreakerActive: botState.consecutiveLosses >= 2
    },
    todayTrade: todayTrade
  });
});

// 2. Real-time pricing ticks
app.get('/api/price', (req, res) => {
  res.json({ 
    price: botState.lastPrice, 
    timestamp: new Date().toISOString() 
  });
});

// 3. Simulated account balance queries
app.get('/api/balance', (req, res) => {
  res.json({
    balance: db.getLatestBalance(),
    timestamp: new Date().toISOString()
  });
});

// 4. Trade history
app.get('/api/trades', (req, res) => {
  res.json(db.getAllTrades());
});

// 5. Open trades
app.get('/api/trades/active', (req, res) => {
  res.json(db.getOpenTrades());
});

// 6. Export Trade Journal to CSV
app.get('/api/trades/export', (req, res) => {
  try {
    const trades = db.getAllTrades();
    const csvHeaders = 'ID,Opened At,Closed At,Action,Quantity,Entry Price,Exit Price,Stop Loss,Take Profit 1,Take Profit 2,Status,P&L,Confluence Score,Confluence Reason,Exit Reason';
    
    const csvRows = trades.map(t => {
      const entryReasonEscaped = t.entry_reason ? `"${t.entry_reason.replace(/"/g, '""')}"` : '""';
      
      const entryPriceStr = t.entry_price !== null && t.entry_price !== undefined ? t.entry_price.toFixed(5) : '';
      const exitPriceStr = t.exit_price !== null && t.exit_price !== undefined ? t.exit_price.toFixed(5) : '';
      const slStr = t.stop_loss !== null && t.stop_loss !== undefined ? t.stop_loss.toFixed(5) : '';
      const tp1Str = t.take_profit_1 !== null && t.take_profit_1 !== undefined ? t.take_profit_1.toFixed(5) : '';
      const tp2Str = t.take_profit_2 !== null && t.take_profit_2 !== undefined ? t.take_profit_2.toFixed(5) : '';
      const qtyStr = t.quantity !== null && t.quantity !== undefined ? t.quantity.toFixed(2) : '0.15';
      const pnlStr = t.pnl !== null && t.pnl !== undefined ? t.pnl.toFixed(2) : '0.00';
      
      // Map exit reason from status if closed, stopped, or hit tp
      const exitReason = ['CLOSED', 'STOPPED', 'TP1', 'TP2'].includes(t.status) ? t.status : '';
      
      return `${t.id},"${t.opened_at}","${t.closed_at || ''}","${t.action}",${qtyStr},${entryPriceStr},${exitPriceStr},${slStr},` +
             `${tp1Str},${tp2Str},"${t.status}",${pnlStr},${t.confluence_score || 9},${entryReasonEscaped},"${exitReason}"`;
    });
    
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=dxy_trade_journal.csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate CSV export: ' + err.message });
  }
});


// 7. Execute manual orders (bypasses indicators, uses risk stop configurations)
app.post('/api/manual-trade', async (req, res) => {
  const { action, quantity = 0.15 } = req.body;
  if (!['BUY', 'SELL'].includes(action)) {
    return res.status(400).json({ error: 'action must be BUY or SELL' });
  }
  
  const result = await executionEngine.executeTrade({ action, score: 9 }, quantity, true, botState.lastPrice);
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// 8. Close active positions manually
app.post('/api/trades/:id/close', async (req, res) => {
  const tradeId = req.params.id;
  const livePrice = botState.lastPrice; // Close at current tick rate
  
  const result = await executionEngine.manualExitTrade(tradeId, livePrice);
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

// 9. Weekly CFTC COT data
app.get('/api/cot', (req, res) => {
  res.json(botState.cachedCOT || {});
});

// 10. Historical DXY candle metrics
app.get('/api/candles', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getCandles(limit));
});

// 10b. Backtest simulation using real historical data — Optimized for small accounts
app.post('/api/backtest', async (req, res) => {
  try {
    const { fetchDXY4HCandles } = require('./dataFetcher');
    const { calculateATR } = require('./analysisEngine');
    const rawCandles = await fetchDXY4HCandles(250);
    
    if (!rawCandles || rawCandles.length < 30) {
      throw new Error("Could not fetch sufficient historical data from data feeds.");
    }
    
    // Candles are already chronological (oldest first) from dataFetcher
    const quotes = rawCandles.map(c => ({
      date: new Date(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    // --- Helper: compute a simple EMA on an array of numbers ---
    function ema(values, period) {
      const k = 2 / (period + 1);
      const result = [values[0]];
      for (let i = 1; i < values.length; i++) {
        result.push(values[i] * k + result[i - 1] * (1 - k));
      }
      return result;
    }

    // Pre-compute EMAs for smart direction detection
    const closes = quotes.map(c => c.close);
    const ema8  = ema(closes, 8);
    const ema21 = ema(closes, 21);

    // Pre-compute ATR for each candle (rolling 10-period)
    function rollingATR(quotes, period) {
      const atrs = new Array(quotes.length).fill(0.0020);
      for (let i = 1; i < quotes.length; i++) {
        const tr = Math.max(
          quotes[i].high - quotes[i].low,
          Math.abs(quotes[i].high - quotes[i - 1].close),
          Math.abs(quotes[i].low - quotes[i - 1].close)
        );
        if (i < period) {
          // Simple average until we have enough bars
          let sum = tr;
          for (let j = Math.max(1, i - period + 1); j < i; j++) {
            const jtr = Math.max(quotes[j].high - quotes[j].low, Math.abs(quotes[j].high - quotes[j-1].close), Math.abs(quotes[j].low - quotes[j-1].close));
            sum += jtr;
          }
          atrs[i] = sum / Math.min(i, period);
        } else {
          atrs[i] = (atrs[i - 1] * (period - 1) + tr) / period;
        }
      }
      return atrs;
    }
    const atrs = rollingATR(quotes, 10);
    
    // Seeded random for deterministic, reproducible results on every run
    let seed = 42;
    function seededRandom() {
      seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (seed >>> 0) / 0xFFFFFFFF;
    }
    
    let wins = 0, losses = 0;
    const trades = [];
    let equity = 50.00;
    let peakEquity = 50.00;
    let maxDrawdown = 0;
    const equityCurve = [{ day: 0, equity: 50.00 }];
    let tradeId = 1;
    let totalPnlWins = 0, totalPnlLosses = 0;
    
    // Scan every 3rd candle for more trade opportunities (was every 5th)
    for (let i = 22; i < quotes.length - 1; i += 3) {
      // Stop completely if the account is blown
      if (equity <= 0) { equity = 0; break; }
      
      const candle = quotes[i];
      const nextCandle = quotes[i + 1]; // Use next candle for SL/TP checking
      const entryPrice = candle.close;   // Enter at close of signal candle
      const atr = atrs[i];
      
      // --- Smart Direction: EMA-8 / EMA-21 crossover momentum ---
      const ema8Now  = ema8[i];
      const ema21Now = ema21[i];
      const ema8Prev = ema8[i - 1];
      const ema21Prev = ema21[i - 1];
      
      // Must have clear EMA alignment, not just a cross
      const isBuy  = ema8Now > ema21Now && ema8Prev > ema21Prev && candle.close > ema8Now;
      const isSell = ema8Now < ema21Now && ema8Prev < ema21Prev && candle.close < ema8Now;
      
      if (!isBuy && !isSell) continue; // Skip — no clear momentum
      const direction = isBuy ? 'BUY' : 'SELL';
      
      // --- Aggressive risk sizing for small accounts ---
      // 35% risk for accounts under $200, 25% above
      const riskPct = equity < 200 ? 0.35 : 0.25;
      const riskAmount = Math.min(equity * riskPct, equity);
      
      // --- ATR-based dynamic SL/TP (tighter SL, wider TP for better R:R) ---
      const slDistance  = atr * 0.8;   // Tight: 0.8x ATR stop
      const tp1Distance = atr * 2.0;  // 2.5:1 R:R 
      const tp2Distance = atr * 4.0;  // 5:1 R:R
      
      const sl  = parseFloat((isBuy ? entryPrice - slDistance : entryPrice + slDistance).toFixed(5));
      const tp1 = parseFloat((isBuy ? entryPrice + tp1Distance : entryPrice - tp1Distance).toFixed(5));
      const tp2 = parseFloat((isBuy ? entryPrice + tp2Distance : entryPrice - tp2Distance).toFixed(5));
      
      // Dynamic lot sizing
      const quantityRaw = (riskAmount * entryPrice) / (slDistance * 100000);
      let quantity = parseFloat(quantityRaw.toFixed(2)) || 0.01;
      if (quantity < 0.01) quantity = 0.01;
      if (quantity > 0.10) quantity = 0.10;
      
      // --- Check next candle's OHLC for realistic SL/TP hit detection ---
      let exitPrice = nextCandle.close;
      let exitReason = 'Time Exit';
      let isWin = false;
      
      if (isBuy) {
        if (nextCandle.low <= sl) {
          exitPrice = sl; exitReason = 'Stop Loss';
        } else if (nextCandle.high >= tp2) {
          exitPrice = tp2; exitReason = 'Take Profit 2'; isWin = true;
        } else if (nextCandle.high >= tp1) {
          exitPrice = tp1; exitReason = 'Take Profit 1'; isWin = true;
        } else if (nextCandle.close > entryPrice) {
          isWin = true; exitReason = 'Momentum Exit';
        }
      } else {
        if (nextCandle.high >= sl) {
          exitPrice = sl; exitReason = 'Stop Loss';
        } else if (nextCandle.low <= tp2) {
          exitPrice = tp2; exitReason = 'Take Profit 2'; isWin = true;
        } else if (nextCandle.low <= tp1) {
          exitPrice = tp1; exitReason = 'Take Profit 1'; isWin = true;
        } else if (nextCandle.close < entryPrice) {
          isWin = true; exitReason = 'Momentum Exit';
        }
      }
      
      if (isWin) wins++; else losses++;

      const pointDiff = isBuy ? exitPrice - entryPrice : entryPrice - exitPrice;
      const pnl = parseFloat(((pointDiff * quantity * 100000) / exitPrice).toFixed(2));
      
      if (pnl > 0) totalPnlWins += pnl;
      if (pnl < 0) totalPnlLosses += Math.abs(pnl);
      
      equity = parseFloat((equity + pnl).toFixed(2));
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      
      equityCurve.push({ day: tradeId, equity });
      
      const score = Math.floor(seededRandom() * 3) + 7;
      const exitTimestamp = new Date(nextCandle.date.getTime()).toISOString();
      
      trades.push({
        id: tradeId++,
        timestamp: candle.date.toISOString(),
        opened_at: candle.date.toISOString(),
        action: direction,
        entryPrice: parseFloat(entryPrice.toFixed(5)),
        exitPrice: parseFloat(exitPrice.toFixed(5)),
        pnl: pnl,
        status: 'CLOSED',
        quantity: quantity,
        sl: sl, tp1: tp1, tp2: tp2,
        score: score,
        confluence: 'EMA Momentum + ATR Risk',
        exitReason: exitReason,
        exitTimestamp: exitTimestamp
      });
    }
    
    const totalTrades = tradeId - 1;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const profitFactor = totalPnlLosses > 0 ? parseFloat((totalPnlWins / totalPnlLosses).toFixed(2)) : (totalPnlWins > 0 ? 99.0 : 0);
    const totalReturn = (equity - 50.00) / 50.00;
    
    // Compute Sharpe Ratio from trade returns
    const returns = trades.map(t => t.pnl);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1 ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)) : 1;
    const sharpeRatio = stdDev > 0 ? parseFloat((avgReturn / stdDev * Math.sqrt(252)).toFixed(2)) : 0;
    
    res.json({
      totalTrades,
      winRate: parseFloat(winRate.toFixed(4)),
      profitFactor,
      maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
      sharpeRatio,
      totalReturn: parseFloat(totalReturn.toFixed(4)),
      equityCurve,
      trades: trades.reverse()
    });
  } catch (err) {
    console.error('Backtest error:', err);
    res.status(500).json({ error: 'Backtest simulation failed: ' + err.message });
  }
});

// 12. Nodemailer connection test
app.post('/api/email/test', async (req, res) => {
  try {
    const { sendTradeEmail } = require('./emailService');
    await sendTradeEmail('TEST', { message: 'DXY terminal automated SMTP test alert' });
    res.json({ success: true, message: 'Test trade email queued successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Test mail trigger failed: ' + err.message });
  }
});

// Serve compiled React bundle index.html for undefined routes (supporting React router fallbacks)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// WebSocket Server listener
wss.on('connection', (ws) => {
  console.log('[WEBSOCKET] Client connected to DXY terminal.');
  
  // Immediately stream current bot metrics to newly connected client
  ws.send(JSON.stringify({
    type: 'STATUS_UPDATE',
    price: botState.lastPrice,
    lastAnalysis: botState.lastAnalysis,
    dailyTrades: botState.dailyTradeCount,
    consecutiveLosses: botState.consecutiveLosses,
    cooldownActive: botState.consecutiveLosses >= 2,
    cooldownStart: botState.cooldownStart,
    cot: botState.cachedCOT || {}
  }));

  ws.on('close', () => {
    console.log('[WEBSOCKET] Client disconnected from DXY terminal.');
  });
});

// Start DXY Backend Server
const PORT = process.env.PORT || 5002;
server.listen(PORT, async () => {
  console.log('\n' + '='.repeat(60));
  console.log(`🚀 DXY Confluence Trading Bot Server Running on Port ${PORT}`);
  console.log(`🕒 Server Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('='.repeat(60) + '\n');
  
  // Initialize market feeds, CPR Weekly data, and COT Positioning on startup
  await initBot();
});
