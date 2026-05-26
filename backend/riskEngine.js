/**
 * Risk Engine - US Dollar Index (DXY) specific risk configurations.
 * Handles Stop Loss boundaries, Take Profit levels, and progressive trailing stops.
 */

/**
 * Calculate the Stop Loss price level based on CPR levels and ATR volatility.
 */
function calculateStopLoss(action, entryPrice, atr, weeklyCPR) {
  const { BC, TC } = weeklyCPR || { BC: entryPrice - 0.0050, TC: entryPrice + 0.0050 };
  const atrMultiplier = 1.05; // Optimized: 0.7x of original 1.5 → tighter SL for better position sizing
  const minStop = atr * 0.35; // Tighter floor (0.7x of 0.5) to match optimized SL
  
  let sl;
  
  if (action === 'BUY') {
    // Stop below BC (bottom of CPR) or 1.5×ATR, whichever is further (conservative)
    const cprStop = entryPrice - Math.abs(entryPrice - BC);
    const atrStop = entryPrice - (atr * atrMultiplier);
    sl = Math.min(cprStop, atrStop);
  } else {
    // Stop above TC (top of CPR) or 1.5×ATR, whichever is further (conservative)
    const cprStop = entryPrice + Math.abs(TC - entryPrice);
    const atrStop = entryPrice + (atr * atrMultiplier);
    sl = Math.max(cprStop, atrStop);
  }
  
  // Enforce absolute floor: stop must be at least 0.5×ATR away to prevent immediate squeeze
  const stopDistance = Math.abs(entryPrice - sl);
  if (stopDistance < minStop) {
    sl = action === 'BUY' ? entryPrice - minStop : entryPrice + minStop;
  }
  
  return parseFloat(sl.toFixed(4));
}

/**
 * Calculate TP1 (1:2 Risk-to-Reward) and TP2 (1:4 Risk-to-Reward) boundaries.
 * Optimized: wider TPs let winners run further for maximum compounding.
 */
function calculateTakeProfits(action, entryPrice, stopLoss) {
  const risk = Math.abs(entryPrice - stopLoss);
  const tp1Distance = risk * 2.0;  // 1:2 RR (optimized from 1:1.5)
  const tp2Distance = risk * 4.0;  // 1:4 RR (optimized from 1:3)
  
  if (action === 'BUY') {
    return {
      tp1: parseFloat((entryPrice + tp1Distance).toFixed(4)),
      tp2: parseFloat((entryPrice + tp2Distance).toFixed(4))
    };
  } else {
    return {
      tp1: parseFloat((entryPrice - tp1Distance).toFixed(4)),
      tp2: parseFloat((entryPrice - tp2Distance).toFixed(4))
    };
  }
}

/**
 * Progressive Trailing Stop calculations.
 * Called periodically on every new price update for active open trades.
 */
function updateTrailingStop(trade, currentPrice, atr) {
  const { action, entry_price, stop_loss } = trade;
  const risk = Math.abs(entry_price - stop_loss);
  
  if (risk === 0) return stop_loss;

  let unrealizedGainUnits;
  if (action === 'BUY') {
    unrealizedGainUnits = (currentPrice - entry_price) / risk;
  } else {
    unrealizedGainUnits = (entry_price - currentPrice) / risk;
  }
  
  let newSL = stop_loss;
  const totalProfit = Math.abs(currentPrice - entry_price);
  
  // Phase 2 Trail: PnL reaches 4.0x risk -> Trail to Break-Even + 60% of total profit
  if (unrealizedGainUnits >= 4.0) {
    newSL = action === 'BUY'
      ? entry_price + (totalProfit * 0.60)
      : entry_price - (totalProfit * 0.60);
  } 
  // Phase 1 Trail: PnL reaches 2.5x risk -> Trail to Break-Even + 10% of total profit
  else if (unrealizedGainUnits >= 2.5) {
    newSL = action === 'BUY'
      ? entry_price + (totalProfit * 0.10)
      : entry_price - (totalProfit * 0.10);
  }
  
  // Trailing stop can only move in the profitable direction, never backward
  if (action === 'BUY') {
    if (newSL > stop_loss) {
      return parseFloat(newSL.toFixed(4));
    }
  } else {
    if (newSL < stop_loss) {
      return parseFloat(newSL.toFixed(4));
    }
  }
  
  return stop_loss;
}

/**
 * Enforce position-size reduction on high-impact macro weeks (e.g., Non-Farm Payrolls).
 */
function getPositionSize(baseSize, isNFPWeek) {
  return isNFPWeek ? baseSize * 0.5 : baseSize;
}

module.exports = {
  calculateStopLoss,
  calculateTakeProfits,
  updateTrailingStop,
  getPositionSize
};
