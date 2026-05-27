const ti = require('technicalindicators');

// Major key USDCAD Support & Resistance Levels
const DXY_KEY_LEVELS = [
  1.2500, 1.2600, 1.2700, 1.2800, 1.2900,
  1.3000, 1.3100, 1.3200, 1.3300, 1.3400,
  1.3500, 1.3600, 1.3700, 1.3800, 1.3900, 1.4000
];

/**
 * Factor 1: EMA Stack Alignment
 * BUY: EMA-21 > EMA-50 > EMA-200 AND price above EMA-21
 * SELL: EMA-21 < EMA-50 < EMA-200 AND price below EMA-21
 */
function checkEMAStack(candles, direction) {
  if (!candles || candles.length < 200) return 0;
  const closes = candles.map(c => c.close);
  
  const ema21 = ti.EMA.calculate({ period: 21, values: closes });
  const ema50 = ti.EMA.calculate({ period: 50, values: closes });
  const ema200 = ti.EMA.calculate({ period: 200, values: closes });
  
  const price = closes[closes.length - 1];
  const e21 = ema21[ema21.length - 1];
  const e50 = ema50[ema50.length - 1];
  const e200 = ema200[ema200.length - 1];
  
  if (!e21 || !e50 || !e200) return 0;
  
  if (direction === 'BUY') {
    return (e21 > e50 && e50 > e200 && price > e21) ? 1 : 0;
  } else {
    return (e21 < e50 && e50 < e200 && price < e21) ? 1 : 0;
  }
}

/**
 * Factor 2: RSI-14 Momentum Corridor
 * Non-overlapping bounds to ensure positive trend momentum without extreme overextensions.
 */
function checkRSI(candles, direction) {
  if (!candles || candles.length < 15) return 0;
  const closes = candles.map(c => c.close);
  
  const rsiValues = ti.RSI.calculate({ period: 14, values: closes });
  const rsi = rsiValues[rsiValues.length - 1];
  
  if (rsi === undefined) return 0;

  if (direction === 'BUY') return (rsi >= 42 && rsi <= 63) ? 1 : 0;
  if (direction === 'SELL') return (rsi >= 37 && rsi <= 58) ? 1 : 0;
  return 0;
}

/**
 * Factor 3: MACD Confirmation + Zero Line
 * BUY: Histogram rising AND MACD Line > 0 (bullish zone)
 * SELL: Histogram falling AND MACD Line < 0 (bearish zone)
 */
function checkMACD(candles, direction) {
  if (!candles || candles.length < 35) return 0;
  const closes = candles.map(c => c.close);
  
  const macdResult = ti.MACD.calculate({
    fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    values: closes, SimpleMAOscillator: false, SimpleMASignal: false
  });
  
  const last = macdResult[macdResult.length - 1];
  const prev = macdResult[macdResult.length - 2];
  if (!last || !prev) return 0;
  
  const histIncreasing = last.histogram > prev.histogram;
  const histDecreasing = last.histogram < prev.histogram;
  const macdAboveZero = last.MACD > 0;
  const macdBelowZero = last.MACD < 0;
  
  if (direction === 'BUY') return (histIncreasing && macdAboveZero) ? 1 : 0;
  if (direction === 'SELL') return (histDecreasing && macdBelowZero) ? 1 : 0;
  return 0;
}

/**
 * Factor 4: Central Pivot Range (CPR) Calculations
 * Calculated from previous full week's candle.
 */
function calculateWeeklyCPR(weeklyCandles) {
  if (!weeklyCandles || weeklyCandles.length < 2) {
    // Default fallback in case weekly charts aren't fully loaded
    return { PP: 1.3650, BC: 1.3580, TC: 1.3720 };
  }
  const prev = weeklyCandles[weeklyCandles.length - 2];
  const PP = (prev.high + prev.low + prev.close) / 3;
  const BC = (prev.high + prev.low) / 2;
  const TC = (2 * PP) - BC;
  
  return {
    PP: parseFloat(PP.toFixed(4)),
    BC: parseFloat(BC.toFixed(4)),
    TC: parseFloat(TC.toFixed(4))
  };
}

function checkCPRProximity(currentPrice, weeklyCPR) {
  if (!weeklyCPR) return 0;
  const { PP, BC, TC } = weeklyCPR;
  const proximityPct = 0.015; // Strict 1.5% buffer for USD Index
  const upper = Math.max(PP, TC) * (1 + proximityPct);
  const lower = Math.min(PP, BC) * (1 - proximityPct);
  
  return (currentPrice >= lower && currentPrice <= upper) ? 1 : 0;
}

/**
 * Factor 5: S/R Key Levels Confluence
 * Within 0.30 tolerance of round significant index boundaries.
 * Must be retested as held support or resistance in the last 60 candles.
 */
function checkKeyLevel(currentPrice, direction, candles) {
  if (!candles || candles.length < 60) return 0;
  const tolerance = 0.0030; // 30 pips tolerance for USDCAD
  
  const testedLevel = DXY_KEY_LEVELS.find(lvl => 
    Math.abs(currentPrice - lvl) <= tolerance
  );
  
  if (!testedLevel) return 0;
  
  const lookback = candles.slice(-60);
  const priorTouches = lookback.filter(c => 
    Math.abs(c.low - testedLevel) <= tolerance || 
    Math.abs(c.high - testedLevel) <= tolerance
  ).length;
  
  return priorTouches >= 2 ? 1 : 0; // Confirms validation of key levels
}

/**
 * Factor 6: Market Structure Break (BOS / CHoCH)
 * Swing extremes scan on a 20-candle lookback window.
 */
function checkMarketStructure(candles, direction) {
  if (!candles || candles.length < 20) return 0;
  const lookback = candles.slice(-20);
  const closes = lookback.map(c => c.close);
  const highs = lookback.map(c => c.high);
  const lows = lookback.map(c => c.low);
  
  const swingHighs = [];
  const swingLows = [];
  
  // Swing extreme checks using a 5-bar local extreme window
  for (let i = 2; i < lookback.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] &&
        highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
      swingHighs.push({ price: highs[i], index: i });
    }
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] &&
        lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
      swingLows.push({ price: lows[i], index: i });
    }
  }
  
  const currentClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  
  if (direction === 'BUY') {
    // BOS: Breaks above the latest swing high
    if (swingHighs.length >= 1) {
      const lastSwingHigh = swingHighs[swingHighs.length - 1].price;
      if (currentClose > lastSwingHigh && prevClose <= lastSwingHigh) return 1;
    }
    // CHoCH: Downtrend printing higher lows
    if (swingLows.length >= 2) {
      const lastLow = swingLows[swingLows.length - 1].price;
      const prevLow = swingLows[swingLows.length - 2].price;
      if (lastLow > prevLow) return 1;
    }
  }
  
  if (direction === 'SELL') {
    // BOS: Breaks below the latest swing low
    if (swingLows.length >= 1) {
      const lastSwingLow = swingLows[swingLows.length - 1].price;
      if (currentClose < lastSwingLow && prevClose >= lastSwingLow) return 1;
    }
    // CHoCH: Uptrend printing lower highs
    if (swingHighs.length >= 2) {
      const lastHigh = swingHighs[swingHighs.length - 1].price;
      const prevHigh = swingHighs[swingHighs.length - 2].price;
      if (lastHigh < prevHigh) return 1;
    }
  }
  
  return 0;
}

/**
 * Factor 7: CFTC COT positioning
 * Handled inside decisionEngine using scoreCOT from cotParser
 */

/**
 * Factor 8: Peer FX component correlation
 * BUY: EUR/USD is below its EMA-21 AND USD/JPY is above its EMA-21
 * SELL: EUR/USD is above its EMA-21 AND USD/JPY is below its EMA-21
 */
function checkPeerFX(direction, eurUsdCandles, usdJpyCandles) {
  if (!eurUsdCandles || !usdJpyCandles || eurUsdCandles.length < 21 || usdJpyCandles.length < 21) {
    return 0; // Return neutral/non-conforming if peer history is not loaded
  }
  
  const eurClose = eurUsdCandles.map(c => c.close);
  const jpyClose = usdJpyCandles.map(c => c.close);
  
  const eurEma21 = ti.EMA.calculate({ period: 21, values: eurClose });
  const jpyEma21 = ti.EMA.calculate({ period: 21, values: jpyClose });
  
  const eurPrice = eurClose[eurClose.length - 1];
  const jpyPrice = jpyClose[jpyClose.length - 1];
  
  const eurTrend = eurPrice > eurEma21[eurEma21.length - 1] ? 'UP' : 'DOWN';
  const jpyTrend = jpyPrice > jpyEma21[jpyEma21.length - 1] ? 'UP' : 'DOWN';
  
  if (direction === 'BUY') {
    return (eurTrend === 'DOWN' && jpyTrend === 'UP') ? 1 : 0;
  }
  if (direction === 'SELL') {
    return (eurTrend === 'UP' && jpyTrend === 'DOWN') ? 1 : 0;
  }
  return 0;
}

/**
 * Factor 9: Volume Escalation
 * 5-candle average volume is at least 15% higher than the prior 5-candle average volume.
 */
function checkVolumeEscalation(candles) {
  if (!candles || candles.length < 10) return 0;
  
  const recent = candles.slice(-5);
  const prior = candles.slice(-10, -5);
  
  const recentVol = recent.reduce((s, c) => s + (c.volume || 0), 0) / 5;
  const priorVol = prior.reduce((s, c) => s + (c.volume || 0), 0) / 5;
  
  if (priorVol === 0) {
    // If prior volume was exactly 0, any recent volume > 0 is an escalation
    return recentVol > 0 ? 1 : 0;
  }
  return (recentVol >= priorVol * 1.15) ? 1 : 0;
}

/**
 * ATR-14 Calculation for risk profiles
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 0.0035; // Safe default for USDCAD (35 pips)
  const atrInput = {
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period
  };
  const atrValues = ti.ATR.calculate(atrInput);
  return atrValues[atrValues.length - 1] || 0.0035;
}

module.exports = {
  checkEMAStack,
  checkRSI,
  checkMACD,
  calculateWeeklyCPR,
  checkCPRProximity,
  checkKeyLevel,
  checkMarketStructure,
  checkPeerFX,
  checkVolumeEscalation,
  calculateATR
};
