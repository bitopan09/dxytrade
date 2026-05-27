const {
  checkEMAStack,
  checkRSI,
  checkMACD,
  checkCPRProximity,
  checkKeyLevel,
  checkMarketStructure,
  checkPeerFX,
  checkVolumeEscalation,
  calculateWeeklyCPR,
  calculateATR
} = require('./analysisEngine');
const { scoreCOT } = require('./cotParser');
const { isBlackedOut } = require('./newsFilter');

/**
 * Main signal generation logic.
 * ALWAYS calculates confluence scores first (for dashboard display),
 * then evaluates risk gates to decide whether to actually execute.
 */
async function generateSignal(
  candles,
  weeklyCandles,
  cotData,
  eurUsdCandles,
  usdJpyCandles,
  newsEvents,
  botState
) {
  if (!candles || candles.length === 0) {
    return { signal: 'NONE', score: 0, reason: 'Insufficient price candles' };
  }

  const currentPrice = candles[candles.length - 1].close;
  const weeklyCPR = calculateWeeklyCPR(weeklyCandles);
  const now = new Date();
  const nowUTC = now.toISOString();
  const threshold = parseInt(process.env.CONFLUENCE_THRESHOLD || 3);

  // ============================================================
  // STEP 1: ALWAYS calculate confluence scores (for dashboard)
  // ============================================================
  const results = {};
  
  for (const direction of ['BUY', 'SELL']) {
    const factors = {
      ema_stack: checkEMAStack(candles, direction),
      rsi_corridor: checkRSI(candles, direction),
      macd_confirm: checkMACD(candles, direction),
      cpr_proximity: checkCPRProximity(currentPrice, weeklyCPR),
      cot_bias: scoreCOT(cotData, direction),
      key_level: checkKeyLevel(currentPrice, direction, candles),
      structure_break: checkMarketStructure(candles, direction),
      peer_fx: checkPeerFX(direction, eurUsdCandles, usdJpyCandles),
      volume_escalate: checkVolumeEscalation(candles)
    };
    
    const score = Object.values(factors).reduce((sum, val) => sum + val, 0);
    results[direction] = { score, factors };
    console.log(`[DECISION ENGINE] ${direction} Factor Breakdown: EMA=${factors.ema_stack} RSI=${factors.rsi_corridor} MACD=${factors.macd_confirm} CPR=${factors.cpr_proximity} COT=${factors.cot_bias} KEY=${factors.key_level} BOS=${factors.structure_break} PEER=${factors.peer_fx} VOL=${factors.volume_escalate} => TOTAL: ${score}/9`);
  }
  
  const buyScore = results['BUY'].score;
  const sellScore = results['SELL'].score;
  const bestScore = Math.max(buyScore, sellScore);
  const bestDirection = buyScore >= sellScore ? 'BUY' : 'SELL';

  // ============================================================
  // STEP 2: Apply risk gates (only blocks EXECUTION, not scoring)
  // ============================================================

  // --- GATE 1: Session Hour Check ---
  const hourUTC = now.getUTCHours();
  if (hourUTC < 8 || hourUTC >= 20) {
    console.log(`[DECISION ENGINE] GATE BLOCKED: Session hours (current: ${hourUTC} UTC, allowed: 08-20 UTC)`);
    return { signal: 'NONE', score: bestScore, reason: `Outside London/NY session hours (08-20 UTC, Current: ${hourUTC} UTC)` };
  }
  
  // --- GATE 2: Macro Economic News Blackout ---
  if (isBlackedOut(newsEvents, nowUTC)) {
    console.log('[DECISION ENGINE] GATE BLOCKED: News blackout active');
    return { signal: 'NONE', score: bestScore, reason: 'Economic calendar high-impact blackout active' };
  }
  
  // --- GATE 3: Daily Trade Limit Circuit Breaker ---
  const dailyLimit = parseInt(process.env.DAILY_TRADE_LIMIT || 2);
  if ((botState.dailyTradeCount || 0) >= dailyLimit) {
    console.log(`[DECISION ENGINE] GATE BLOCKED: Daily limit reached (${botState.dailyTradeCount}/${dailyLimit})`);
    return { signal: 'NONE', score: bestScore, reason: `Daily trade limit reached (${botState.dailyTradeCount}/${dailyLimit})` };
  }
  
  // --- GATE 4: Loss Streak Cooldown Circuit Breaker ---
  if ((botState.consecutiveLosses || 0) >= 2) {
    const cooldownStart = new Date(botState.cooldownStart);
    const cooldownExpiry = new Date(cooldownStart.getTime() + 24 * 60 * 60 * 1000);
    if (now < cooldownExpiry) {
      const remainingHrs = ((cooldownExpiry - now) / (1000 * 60 * 60)).toFixed(1);
      console.log(`[DECISION ENGINE] GATE BLOCKED: Loss cooldown active (${remainingHrs} hrs remaining)`);
      return { signal: 'NONE', score: bestScore, reason: `24H Cooldown active after consecutive losses (${remainingHrs} hrs remaining)` };
    }
  }

  // ============================================================
  // STEP 3: Evaluate trade signals
  // ============================================================
  
  // --- GATE 5: Conflicting Signal Guard ---
  if (buyScore >= threshold && sellScore >= threshold) {
    console.log(`[DECISION ENGINE] GATE BLOCKED: Conflicting signals (BUY: ${buyScore}, SELL: ${sellScore})`);
    return { 
      signal: 'NONE', 
      score: bestScore,
      reason: `Conflicting high-score signals (BUY: ${buyScore}, SELL: ${sellScore})` 
    };
  }
  
  // Select highest score that meets the threshold
  if (buyScore >= threshold && buyScore > sellScore) {
    return {
      signal: 'BUY',
      score: buyScore,
      factors: results['BUY'].factors,
      cpr: weeklyCPR,
      atr: calculateATR(candles)
    };
  }
  
  if (sellScore >= threshold && sellScore > buyScore) {
    return {
      signal: 'SELL',
      score: sellScore,
      factors: results['SELL'].factors,
      cpr: weeklyCPR,
      atr: calculateATR(candles)
    };
  }
  
  console.log(`[DECISION ENGINE] NO SIGNAL: Score below threshold (BUY: ${buyScore}/9, SELL: ${sellScore}/9, Required: ${threshold})`);
  return { 
    signal: 'NONE', 
    score: bestScore,
    reason: `Score below threshold (BUY: ${buyScore}/9, SELL: ${sellScore}/9, Required: ${threshold})` 
  };
}

module.exports = { generateSignal };

