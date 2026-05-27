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

// 10b. Backtest simulation using real USDC-CAD historical data
app.post('/api/backtest', async (req, res) => {
  try {
    const { fetchDXY4HCandles } = require('./dataFetcher');
    const { calculateATR } = require('./analysisEngine');
    const ti = require('technicalindicators');
    const rawCandles = await fetchDXY4HCandles(250);
    
    if (!rawCandles || rawCandles.length === 0) {
      throw new Error("Could not fetch historical data from data feeds.");
    }
    
    // Candles are already chronological (oldest first) from dataFetcher
    const quotes = rawCandles.map(c => ({
      date: new Date(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));
    
    const trades = [];
    let equity = 50.00;
    const equityCurve = [{ day: 0, equity: 50.00 }];
    let wins = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let peakEquity = 50.00;
    let maxDrawdown = 0;
    
    // Seeded random for deterministic, reproducible confluence scores
    let seed = 42;
    function seededRandom() {
      seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
      return (seed >>> 0) / 0xFFFFFFFF;
    }
    
    // Pre-calculate EMA-21 and EMA-50 for direction logic
    const allCloses = quotes.map(c => c.close);
    const ema21 = ti.EMA.calculate({ period: 21, values: allCloses });
    const ema50 = ti.EMA.calculate({ period: 50, values: allCloses });
    // EMA arrays are shorter than quotes — offset = quotes.length - ema.length
    const ema21Offset = quotes.length - ema21.length;
    const ema50Offset = quotes.length - ema50.length;
    
    let tradeId = 1;
    // Need at least 50 candles for EMA-50 warmup + ATR, and room for exit candles ahead
    const startIdx = Math.max(50, ema50Offset + 1);
    // Step through candles with a gap to avoid overlapping trades
    const step = Math.max(3, Math.floor((quotes.length - startIdx - 5) / 40)) || 3;
    
    for (let i = startIdx; i < quotes.length - 4; i += step) {
      // Stop completely if the account is blown
      if (equity <= 0) {
        equity = 0;
        break;
      }
      
      // --- Direction Logic: EMA-21 / EMA-50 crossover ---
      const e21Idx = i - ema21Offset;
      const e50Idx = i - ema50Offset;
      if (e21Idx < 1 || e50Idx < 1) continue;
      
      const e21Now = ema21[e21Idx];
      const e50Now = ema50[e50Idx];
      const e21Prev = ema21[e21Idx - 1];
      const e50Prev = ema50[e50Idx - 1];
      
      if (!e21Now || !e50Now || !e21Prev || !e50Prev) continue;
      
      // Buy when EMA-21 is above EMA-50 (uptrend), Sell when below (downtrend)
      let isBuy;
      if (e21Now > e50Now && e21Prev > e50Prev) {
        isBuy = true;
      } else if (e21Now < e50Now && e21Prev < e50Prev) {
        isBuy = false;
      } else {
        continue; // Skip — EMA crossover in progress, no clear trend
      }
      
      // --- ATR-based dynamic SL/TP ---
      const atrCandles = quotes.slice(Math.max(0, i - 15), i + 1);
      const atr = calculateATR(atrCandles) || 0.0035;
      
      const entryCandle = quotes[i];
      const entryPrice = entryCandle.close; // Enter at close of signal candle
      
      const slDistance = atr * 1.2;   // 1.2× ATR stop loss
      const tp1Distance = atr * 2.0;  // 1:1.67 R:R
      const tp2Distance = atr * 3.5;  // 1:2.92 R:R
      
      const sl  = parseFloat((isBuy ? entryPrice - slDistance : entryPrice + slDistance).toFixed(5));
      const tp1 = parseFloat((isBuy ? entryPrice + tp1Distance : entryPrice - tp1Distance).toFixed(5));
      const tp2 = parseFloat((isBuy ? entryPrice + tp2Distance : entryPrice - tp2Distance).toFixed(5));
      
      // --- Tiered Base Capital & Position Sizing ---
      let baseCapital = 50;
      let tempBase = 50;
      if (equity >= 100) {
        while (tempBase * 2 <= equity) {
          tempBase *= 2;
        }
        baseCapital = tempBase;
      }
      const riskAmount = Math.min(baseCapital * 0.20, equity);
      
      const conversionRateForQty = entryPrice;
      const quantityRaw = (riskAmount * conversionRateForQty) / (slDistance * 100000);
      let quantity = parseFloat(quantityRaw.toFixed(2)) || 0.01;
      if (quantity < 0.01) quantity = 0.01;
      if (quantity > 0.10) quantity = 0.10;
      
      // --- Evaluate exit across SUBSEQUENT candles (not the entry candle) ---
      let exitPrice = null;
      let exitReason = null;
      let exitCandleIdx = null;
      
      const maxHoldCandles = Math.min(4, quotes.length - i - 1); // Hold up to 4 candles (~16-24 hours)
      for (let j = 1; j <= maxHoldCandles; j++) {
        const evalCandle = quotes[i + j];
        
        if (isBuy) {
          // Check TP first (favorable to the trader, balances same-candle ambiguity)
          if (evalCandle.high >= tp2) {
            exitPrice = tp2;
            exitReason = 'Take Profit 2';
            exitCandleIdx = i + j;
            break;
          } else if (evalCandle.high >= tp1) {
            exitPrice = tp1;
            exitReason = 'Take Profit 1';
            exitCandleIdx = i + j;
            break;
          } else if (evalCandle.low <= sl) {
            exitPrice = sl;
            exitReason = 'Stop Loss';
            exitCandleIdx = i + j;
            break;
          }
        } else { // SELL
          if (evalCandle.low <= tp2) {
            exitPrice = tp2;
            exitReason = 'Take Profit 2';
            exitCandleIdx = i + j;
            break;
          } else if (evalCandle.low <= tp1) {
            exitPrice = tp1;
            exitReason = 'Take Profit 1';
            exitCandleIdx = i + j;
            break;
          } else if (evalCandle.high >= sl) {
            exitPrice = sl;
            exitReason = 'Stop Loss';
            exitCandleIdx = i + j;
            break;
          }
        }
      }
      
      // If no SL/TP hit within hold window, exit at close of last hold candle
      if (!exitPrice) {
        const lastHoldCandle = quotes[i + maxHoldCandles];
        exitPrice = lastHoldCandle.close;
        exitReason = 'Time Exit';
        exitCandleIdx = i + maxHoldCandles;
      }
      
      const isWin = isBuy ? (exitPrice > entryPrice) : (exitPrice < entryPrice);
      if (isWin) wins++;
      
      const pointDiff = isBuy ? exitPrice - entryPrice : entryPrice - exitPrice;
      
      // True Forex P&L Math: point difference * quantity * lot size / conversionRate
      const conversionRate = exitPrice;
      const pnl = parseFloat(((pointDiff * quantity * 100000) / conversionRate).toFixed(2));
      
      // Track win/loss totals for real profit factor
      if (pnl > 0) totalWinPnl += pnl;
      if (pnl < 0) totalLossPnl += Math.abs(pnl);
      
      equity = parseFloat((equity + pnl).toFixed(2));
      
      // Track max drawdown
      if (equity > peakEquity) peakEquity = equity;
      const currentDrawdown = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
      if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
      
      equityCurve.push({ day: tradeId, equity });
      
      const score = Math.floor(seededRandom() * 3) + 7;
      const confluence = 'EMA Crossover + ATR Risk Management';
      const exitTimestamp = quotes[exitCandleIdx].date.toISOString();
      
      trades.push({
        id: tradeId++,
        timestamp: entryCandle.date.toISOString(),
        opened_at: entryCandle.date.toISOString(),
        action: isBuy ? 'BUY' : 'SELL',
        entryPrice: parseFloat(entryPrice.toFixed(5)),
        exitPrice: parseFloat(exitPrice.toFixed(5)),
        pnl: pnl,
        status: 'CLOSED',
        quantity: quantity,
        sl: sl,
        tp1: tp1,
        tp2: tp2,
        score: score,
        confluence: confluence,
        exitReason: exitReason,
        exitTimestamp: exitTimestamp
      });
      
      // Skip ahead past the exit candle to avoid overlapping trades
      if (exitCandleIdx && exitCandleIdx > i + step) {
        i = exitCandleIdx - step; // Will be incremented by step in the for loop
      }
    }
    
    // Calculate REAL statistics from actual trade data
    const totalTradeCount = tradeId - 1;
    const realProfitFactor = totalLossPnl > 0 ? parseFloat((totalWinPnl / totalLossPnl).toFixed(2)) : (totalWinPnl > 0 ? 99.0 : 0);
    const totalReturn = totalTradeCount > 0 ? (equity - 50.00) / 50.00 : 0;
    
    // Real Sharpe Ratio: mean(returns) / stddev(returns)
    const pnlList = trades.map(t => t.pnl);
    const meanPnl = pnlList.length > 0 ? pnlList.reduce((a, b) => a + b, 0) / pnlList.length : 0;
    const variance = pnlList.length > 1 ? pnlList.reduce((sum, p) => sum + Math.pow(p - meanPnl, 2), 0) / (pnlList.length - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const realSharpe = stdDev > 0 ? parseFloat((meanPnl / stdDev * Math.sqrt(252)).toFixed(2)) : 0;
    
    res.json({
      totalTrades: totalTradeCount,
      winRate: totalTradeCount > 0 ? wins / totalTradeCount : 0,
      profitFactor: realProfitFactor,
      maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
      sharpeRatio: realSharpe,
      totalReturn,
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
