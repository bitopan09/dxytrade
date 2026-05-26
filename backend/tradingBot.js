const cron = require('node-cron');
const { 
  fetchDXY4HCandles, 
  fetchDXYWeeklyCandles, 
  fetchDXYLivePrice, 
  fetchPeerFXCandles 
} = require('./dataFetcher');
const { generateSignal } = require('./decisionEngine');
const { executeTrade, manageOpenTrades } = require('./executionEngine');
const { fetchCOTData } = require('./cotParser');
const { fetchEconomicCalendar } = require('./newsFilter');
const { sendTradeEmail, sendDailySummaryEmail } = require('./emailService');
const db = require('./db');

let botState = {
  enabled: process.env.BOT_ENABLED === 'true',
  dailyTradeCount: 0,
  consecutiveLosses: 0,
  cooldownStart: null,
  lastAnalysis: null,
  lastPrice: 104.5,
  cachedCOT: null,
  cachedNews: [],
  weeklyCandles: [],
  eurUsdCandles: [],
  usdJpyCandles: [],
  currentScore: 0,
  currentSignal: 'NEUTRAL'
};

// 1. Initial State Sync & Restore from Database
function restoreState() {
  try {
    const savedCount = db.getBotState('dailyTradeCount');
    const savedLosses = db.getBotState('consecutiveLosses');
    const savedCooldown = db.getBotState('cooldownStart');
    
    if (savedCount !== null) botState.dailyTradeCount = savedCount;
    if (savedLosses !== null) botState.consecutiveLosses = savedLosses;
    if (savedCooldown !== null) botState.cooldownStart = savedCooldown;
    
    console.log('[BOT ENGINE] Bot state restored from SQLite. Daily count:', botState.dailyTradeCount, 'Consecutive losses:', botState.consecutiveLosses);
  } catch (err) {
    console.error('[BOT ENGINE] Failed to restore bot state:', err.message);
  }
}

// 2. High-Fidelity Data Synchronization Routine
async function syncBotFeeds() {
  try {
    console.log('[BOT ENGINE] Synchronizing market feeds...');
    
    // Fetch DXY historical 4H candles & insert into DB
    const candles = await fetchDXY4HCandles(250);
    if (candles && candles.length > 0) {
      db.insertCandles(candles);
      botState.lastPrice = candles[candles.length - 1].close;
      console.log(`[BOT ENGINE] Loaded ${candles.length} DXY 4H candles. Current Spot: ${botState.lastPrice}`);
    }
    
    // Fetch weekly candles for CPR calculation
    botState.weeklyCandles = await fetchDXYWeeklyCandles(52);
    console.log(`[BOT ENGINE] Loaded ${botState.weeklyCandles.length} Weekly candles for CPR calculations.`);

    // Fetch Peer FX components for inter-market checks
    botState.eurUsdCandles = await fetchPeerFXCandles('eurusd', 100);
    botState.usdJpyCandles = await fetchPeerFXCandles('usdjpy', 100);
    console.log('[BOT ENGINE] Loaded Peer FX components: EUR/USD & USD/JPY history.');

    // Fetch commitments of traders weekly report
    const latestCOT = db.getLatestCOT();
    if (latestCOT) {
      botState.cachedCOT = latestCOT;
    } else {
      botState.cachedCOT = await fetchCOTData();
      db.insertCOT(botState.cachedCOT);
    }
    console.log('[BOT ENGINE] Institutional weekly COT data loaded:', botState.cachedCOT?.week_date);

    // Fetch ForexFactory high-impact economic news events
    botState.cachedNews = await fetchEconomicCalendar();
    console.log(`[BOT ENGINE] Loaded ${botState.cachedNews.length} high-impact USD economic calendar events.`);
    
    botState.lastAnalysis = new Date().toISOString();
  } catch (err) {
    console.error('[BOT ENGINE] Feed synchronization failed:', err.message);
  }
}

/**
 * Main automated analysis loop.
 * Analyzes market indicators, manages trailing stops, checks SL/TP hits, and enters new trades.
 */
async function performMarketAnalysis() {
  try {
    console.log('[BOT ENGINE] Running periodic market analysis tick...');
    
    // Refresh 4H candles
    const candles = await fetchDXY4HCandles(250);
    if (!candles || candles.length === 0) {
      throw new Error('Could not retrieve DXY index candles');
    }
    
    // Store candles in DB
    db.insertCandles(candles);
    botState.lastPrice = candles[candles.length - 1].close;
    botState.lastAnalysis = new Date().toISOString();

    // Check existing trades - update trailing stops and evaluate exit signals
    // (We want to manage open trades even if the bot is "paused" from taking new ones)
    await manageOpenTrades(candles, botState);

    // Refresh peer components and CPR bounds for decision engine
    botState.eurUsdCandles = await fetchPeerFXCandles('eurusd', 100);
    botState.usdJpyCandles = await fetchPeerFXCandles('usdjpy', 100);
    
    // Generate new signals
    const signal = await generateSignal(
      candles,
      botState.weeklyCandles,
      botState.cachedCOT,
      botState.eurUsdCandles,
      botState.usdJpyCandles,
      botState.cachedNews,
      botState
    );

    botState.currentScore = signal.score || 0;
    botState.currentSignal = signal.signal || 'NEUTRAL';

    console.log('[BOT ENGINE] Confluence Scan Result:', signal.signal, signal.reason || `Score: ${signal.score}/9`);

    // Only execute new trades if the bot is currently ENABLED
    if (signal.signal !== 'NONE' && botState.enabled) {
      const result = await executeTrade(signal, 0.15, false, botState.lastPrice); // Default quantity = 0.15 lots
      if (result.success) {
        botState.dailyTradeCount++;
        db.saveBotState('dailyTradeCount', botState.dailyTradeCount);
        
        // Send email trade notification
        await sendTradeEmail(signal.signal, result.trade);
      }
    }

    // Broadcast update to all WebSocket clients
    broadcastStatus();

  } catch (err) {
    console.error('[BOT ENGINE] Analysis cycle error:', err.message);
    if (process.env.SEND_ERROR_ALERTS === 'true') {
      sendTradeEmail('ERROR', { error: err.message }).catch(() => {});
    }
  }
}

// ==================== CRON SCHEDULES ====================

// A. Analysis loop - runs every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await performMarketAnalysis();
});

// B. COT refresh - every Friday 16:00 UTC (following CFTC's Friday 15:30 Eastern release)
cron.schedule('0 16 * * 5', async () => {
  try {
    console.log('[BOT ENGINE] Cron: Refreshing weekly CFTC COT positioning...');
    botState.cachedCOT = await fetchCOTData();
    db.insertCOT(botState.cachedCOT);
    console.log('[BOT ENGINE] Weekly COT positioning refreshed successfully.');
    broadcastStatus();
  } catch (err) {
    console.error('[BOT ENGINE] Friday COT cron fetch error:', err.message);
  }
});

// C. Economic calendar refresh - every day at 00:05 UTC
cron.schedule('5 0 * * *', async () => {
  try {
    console.log('[BOT ENGINE] Cron: Refreshing economic news calendar and resetting daily limits...');
    botState.cachedNews = await fetchEconomicCalendar();
    
    // Reset daily trade count limit at start of UTC day
    botState.dailyTradeCount = 0;
    db.saveBotState('dailyTradeCount', 0);
    
    console.log('[BOT ENGINE] News calendar refreshed. Daily trading limit counter reset.');
    broadcastStatus();
  } catch (err) {
    console.error('[BOT ENGINE] News calendar cron fetch error:', err.message);
  }
});

// D. Daily performance summary email - midnight IST = 18:30 UTC
cron.schedule('30 18 * * *', async () => {
  try {
    console.log('[BOT ENGINE] Cron: Generating and sending daily summary email...');
    const trades = db.getTodaysTrades();
    await sendDailySummaryEmail(trades, botState.lastPrice);
  } catch (err) {
    console.error('[BOT ENGINE] Daily summary cron failed:', err.message);
  }
});

// E. Real-time Ticker Broadcast - polls Kraken every 5 seconds
let tickerInterval = setInterval(async () => {
  try {
    const live = await fetchDXYLivePrice();
    botState.lastPrice = live.price;
    
    // Broadcast live ticks to WebSocket clients regardless of trading status
    broadcastStatus();
  } catch (err) {
    // Suppress console spam for tick failures
  }
}, 5000);

// WebSocket status broadcast function
function broadcastStatus() {
  if (global.wss) {
    const payload = JSON.stringify({
      type: 'STATUS_UPDATE',
      price: botState.lastPrice,
      lastAnalysis: botState.lastAnalysis,
      dailyTrades: botState.dailyTradeCount,
      consecutiveLosses: botState.consecutiveLosses,
      cooldownActive: botState.consecutiveLosses >= 2,
      cooldownStart: botState.cooldownStart,
      cot: botState.cachedCOT,
      currentScore: botState.currentScore,
      currentSignal: botState.currentSignal
    });
    
    global.wss.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket OPEN
        client.send(payload);
      }
    });
  }
}

// 3. Automated Initializer on Startup
async function initBot() {
  restoreState();
  await syncBotFeeds();
  // Perform an immediate analysis cycle so the dashboard shows real-time scores right after boot
  await performMarketAnalysis();
  console.log('[BOT ENGINE] Bot orchestrator fully initialized and operational!');
}

module.exports = { 
  botState, 
  initBot, 
  performMarketAnalysis, 
  syncBotFeeds 
};
