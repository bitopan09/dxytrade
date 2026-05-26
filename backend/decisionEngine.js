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
 * Evaluates risk gates first, then calculates confluence scores for BUY and SELL.
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
    return { signal: 'NONE', reason: 'Insufficient price candles' };
  }

  const currentPrice = candles[candles.length - 1].close;
  const weeklyCPR = calculateWeeklyCPR(weeklyCandles);
  const now = new Date();
  const nowUTC = now.toISOString();
  
  // --- GATE 1: Session Hour Check ---
  // London & NY Session peak liquidity overlap: 08:00 - 20:00 UTC
  const hourUTC = now.getUTCHours();
  if (hourUTC < 8 || hourUTC >= 20) {
    return { signal: 'NONE', reason: `Outside London/NY session hours (08-20 UTC, Current: ${hourUTC} UTC)` };
  }
  
  // --- GATE 2: Macro Economic News Blackout ---
  if (isBlackedOut(newsEvents, nowUTC)) {
    return { signal: 'NONE', reason: 'Economic calendar high-impact blackout active' };
  }
  
  // --- GATE 3: Daily Trade Limit Circuit Breaker ---
  const dailyLimit = parseInt(process.env.DAILY_TRADE_LIMIT || 3); // Increased to 3 for small account compounding
  if ((botState.dailyTradeCount || 0) >= dailyLimit) {
    return { signal: 'NONE', reason: `Daily trade limit reached (${botState.dailyTradeCount}/${dailyLimit})` };
  }
  
  // --- GATE 4: Loss Streak Cooldown Circuit Breaker ---
  if ((botState.consecutiveLosses || 0) >= 2) {
    const cooldownStart = new Date(botState.cooldownStart);
    const cooldownExpiry = new Date(cooldownStart.getTime() + 24 * 60 * 60 * 1000); // 24 Hours Cooldown
    if (now < cooldownExpiry) {
      const remainingHrs = ((cooldownExpiry - now) / (1000 * 60 * 60)).toFixed(1);
      return { signal: 'NONE', reason: `24H Cooldown active after consecutive losses (${remainingHrs} hrs remaining)` };
    }
  }

  // --- SCORE CONFLUENCE IN BOTH DIRECTIONS ---
  const results = {};
  const threshold = parseInt(process.env.CONFLUENCE_THRESHOLD || 5); // Lowered to 5 for more aggressive setups
  
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
  }
  
  const buyScore = results['BUY'].score;
  const sellScore = results['SELL'].score;
  
  // --- GATE 5: Conflicting Signal Guard ---
  // If both directions score above threshold, the market is highly erratic. Skip to save capital.
  if (buyScore >= threshold && sellScore >= threshold) {
    return { signal: 'NONE', reason: `Conflicting high-score signals (BUY: ${buyScore}, SELL: ${sellScore})` };
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
  
  return { 
    signal: 'NONE', 
    reason: `Score below threshold (BUY: ${buyScore}/9, SELL: ${sellScore}/9, Required: ${threshold})` 
  };
}

module.exports = { generateSignal };
