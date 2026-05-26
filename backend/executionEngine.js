const db = require('./db');
const { calculateStopLoss, calculateTakeProfits, updateTrailingStop } = require('./riskEngine');
const { calculateATR } = require('./analysisEngine');

// USDCAD Lot size standard: 1 standard lot = 100,000 USD base currency face value
const LOT_SIZE = 100000;

/**
 * Execute a new trade signal (simulated paper trading).
 */
async function executeTrade(signal, quantity = 0.15, isManual = false, livePriceOverride = null) {
  try {
    const action = signal.action || signal.signal;
    if (!action || action === 'NONE') {
      return { success: false, reason: 'Invalid or neutral trade signal' };
    }

    const dbCandles = db.getCandles(15);
    if (!dbCandles || dbCandles.length === 0) {
      return { success: false, reason: 'No candles loaded in database to execute trade' };
    }

    const entryPrice = livePriceOverride || dbCandles[dbCandles.length - 1].close;
    const atr = signal.atr || calculateATR(dbCandles);
    const cpr = signal.cpr || null; // Will calculate inside calculateStopLoss if null

    const sl = calculateStopLoss(action, entryPrice, atr, cpr);
    const { tp1, tp2 } = calculateTakeProfits(action, entryPrice, sl);

    const currentBalance = db.getLatestBalance();
    
    // === EQUITY FLOOR PROTECTION ===
    // Never risk the base capital. If balance drops to $50, stop all trading.
    const EQUITY_FLOOR = 50.00;
    if (currentBalance <= EQUITY_FLOOR) {
      return {
        success: false,
        reason: `EQUITY FLOOR PROTECTION: Balance ($${currentBalance.toFixed(2)}) has reached the $${EQUITY_FLOOR.toFixed(2)} base capital floor. Trading is paused to protect your capital.`
      };
    }
    
    // Tiered base capital logic for Risk Management
    let baseCapital = 50;
    let tempBase = 50;
    if (currentBalance >= 100) {
        while (tempBase * 2 <= currentBalance) {
            tempBase *= 2;
        }
        baseCapital = tempBase;
    }
    
    // Cap the risk amount so a single trade can never push balance below the floor
    const maxRiskable = currentBalance - EQUITY_FLOOR;
    const riskAmount = Math.min(baseCapital * 0.20, maxRiskable); // 20% of active tier, capped at available risk room

    // Calculate dynamic position size (quantity in lots) based on risk amount
    const slDistance = Math.max(Math.abs(entryPrice - sl), 0.0001); // Prevent division by zero
    // Formula: Risk_USD = (slDistance * dynamicQuantity * LOT_SIZE) / entryPrice
    // dynamicQuantity = (Risk_USD * entryPrice) / (slDistance * LOT_SIZE)
    const quantityRaw = (riskAmount * entryPrice) / (slDistance * LOT_SIZE);
    
    // Use dynamic quantity for bot trades, preserve manual quantity if passed for manual trades
    let finalQuantity = isManual ? quantity : (parseFloat(quantityRaw.toFixed(2)) || 0.01);
    
    // Dynamic Lot Size Constraint: 0.01 to 0.1 max
    if (!isManual) {
      if (finalQuantity < 0.01) finalQuantity = 0.01;
      if (finalQuantity > 0.10) finalQuantity = 0.10;
    }
    
    // Check if we have enough simulated balance to support trade margin (rough estimate)
    // Contract value in USD = finalQuantity * LOT_SIZE. Margin required = 0.5% of value (1:200 leverage).
    const contractValue = finalQuantity * LOT_SIZE;
    const marginRequired = contractValue * 0.005;

    if (currentBalance < marginRequired) {
      return { 
        success: false, 
        reason: `Insufficient simulated balance. Need $${marginRequired.toFixed(2)} margin, have $${currentBalance.toFixed(2)}` 
      };
    }

    const trade = {
      action,
      entry_price: entryPrice,
      stop_loss: sl,
      take_profit_1: tp1,
      take_profit_2: tp2,
      quantity: finalQuantity,
      confluence_score: signal.score || 9, // Default 9 for manual trade overrides
      entry_reason: isManual ? '{"manual_trade":1}' : JSON.stringify(signal.factors || {}),
      status: 'OPEN',
      opened_at: new Date().toISOString(),
      ist_date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };

    const tradeId = db.insertTrade(trade);
    console.log(`[EXECUTION ENGINE] ${action} Order Executed! ID: ${tradeId} @ ${entryPrice} SL: ${sl} TP1: ${tp1} TP2: ${tp2}`);
    
    return {
      success: true,
      tradeId,
      trade: { id: tradeId, ...trade }
    };
  } catch (err) {
    console.error('Error executing trade:', err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Handle active trade exit evaluation.
 * Evaluates Stop Loss breach, Take Profit hits, and trailing stop progression.
 */
async function manageOpenTrades(candles, botState) {
  try {
    const openTrades = db.getOpenTrades();
    if (!openTrades || openTrades.length === 0) return;

    const currentPrice = candles[candles.length - 1].close;
    const atr = calculateATR(candles);

    for (const trade of openTrades) {
      // 1. Update Trailing Stop
      const newSL = updateTrailingStop(trade, currentPrice, atr);
      if (newSL !== trade.stop_loss) {
        db.updateTradeStopLoss(trade.id, newSL);
        trade.stop_loss = newSL; // Local memory update
        console.log(`[EXECUTION ENGINE] Trailing Stop Loss updated for Trade ID ${trade.id} to ${newSL}`);
      }

      let exitPrice = currentPrice;
      let closeReason = null;
      const { action, entry_price, stop_loss, take_profit_1, take_profit_2 } = trade;

      // 2. Check Stop Loss breach
      if (action === 'BUY' && currentPrice <= stop_loss) {
        exitPrice = stop_loss;
        closeReason = 'STOPPED';
      } else if (action === 'SELL' && currentPrice >= stop_loss) {
        exitPrice = stop_loss;
        closeReason = 'STOPPED';
      }

      // 3. Check Take Profit hits
      if (!closeReason) {
        if (action === 'BUY') {
          if (currentPrice >= take_profit_2) {
            exitPrice = take_profit_2;
            closeReason = 'TP2';
          } else if (currentPrice >= take_profit_1) {
            exitPrice = take_profit_1;
            closeReason = 'TP1';
          }
        } else { // SELL
          if (currentPrice <= take_profit_2) {
            exitPrice = take_profit_2;
            closeReason = 'TP2';
          } else if (currentPrice <= take_profit_1) {
            exitPrice = take_profit_1;
            closeReason = 'TP1';
          }
        }
      }

      // 4. Close Trade if a target is breached
      if (closeReason) {
        const pointDiff = action === 'BUY' 
          ? exitPrice - entry_price 
          : entry_price - exitPrice;
        
        // PnL in USD = point difference * quantity * lot size / currentPrice (to match live FX conversion rates)
        const LOT_SIZE = 100000;
        const pnl = (pointDiff * trade.quantity * LOT_SIZE) / currentPrice;
        
        db.closeTrade(trade.id, exitPrice, closeReason, pnl);
        
        // Adjust virtual paper cash balance
        const currentBalance = db.getLatestBalance();
        const newBalance = currentBalance + pnl;
        db.updateBalance(newBalance);

        // Update circuit-breaker states
        if (closeReason === 'STOPPED') {
          botState.consecutiveLosses = (botState.consecutiveLosses || 0) + 1;
          if (botState.consecutiveLosses >= 2) {
            botState.cooldownStart = new Date().toISOString();
            db.saveBotState('consecutiveLosses', botState.consecutiveLosses);
            db.saveBotState('cooldownStart', botState.cooldownStart);
            console.log('Circuit breaker triggered! 2 consecutive losses. Cooldown active.');
          } else {
            db.saveBotState('consecutiveLosses', botState.consecutiveLosses);
          }
        } else {
          // Reset losses on winning TP hit
          botState.consecutiveLosses = 0;
          db.saveBotState('consecutiveLosses', 0);
        }

        console.log(`[EXECUTION ENGINE] Trade ID ${trade.id} Closed (${closeReason}) @ ${exitPrice}! PnL: $${pnl.toFixed(2)}. Balance: $${newBalance.toFixed(2)}`);

        // Send Email notification asynchronously
        const { sendTradeEmail } = require('./emailService');
        sendTradeEmail('CLOSED', {
          id: trade.id,
          action,
          entry_price,
          exit_price: exitPrice,
          stop_loss: trade.stop_loss,
          take_profit_1,
          take_profit_2,
          pnl: `$${pnl.toFixed(2)} (${pointDiff.toFixed(3)} pts)`,
          reason: closeReason,
          opened_at: trade.opened_at,
          closed_at: new Date().toISOString()
        }).catch(err => console.error('SMTP closed notification alert failed:', err.message));
      }
    }
  } catch (err) {
    console.error('Error managing active open trades:', err.message);
  }
}

/**
 * Handle a manual exit instruction from the React Dashboard.
 */
async function manualExitTrade(tradeId, forceExitPrice) {
  try {
    const openTrades = db.getOpenTrades();
    const trade = openTrades.find(t => t.id === parseInt(tradeId));
    if (!trade) {
      return { success: false, reason: `Active open trade with ID ${tradeId} not found` };
    }

    const exitPrice = forceExitPrice || trade.entry_price;
    const pointDiff = trade.action === 'BUY' 
      ? exitPrice - trade.entry_price 
      : trade.entry_price - exitPrice;
    
    // PnL in USD = point difference * quantity * lot size / conversionRate (matching standard OctaFX conversion at live rates)
    const { botState } = require('./tradingBot');
    const conversionRate = botState?.lastPrice || exitPrice;
    const LOT_SIZE = 100000;
    const pnl = (pointDiff * trade.quantity * LOT_SIZE) / conversionRate;

    db.closeTrade(trade.id, exitPrice, 'CLOSED', pnl);
    
    // Adjust balance sheet
    const currentBalance = db.getLatestBalance();
    const newBalance = currentBalance + pnl;
    db.updateBalance(newBalance);

    console.log(`[EXECUTION ENGINE] Trade ID ${trade.id} Manually Closed @ ${exitPrice}! PnL: $${pnl.toFixed(2)}. Balance: $${newBalance.toFixed(2)}`);

    const { sendTradeEmail } = require('./emailService');
    sendTradeEmail('CLOSED', {
      id: trade.id,
      action: trade.action,
      entry_price: trade.entry_price,
      exit_price: exitPrice,
      pnl: `$${pnl.toFixed(2)} (${pointDiff.toFixed(3)} pts)`,
      reason: 'MANUAL EXIT',
      opened_at: trade.opened_at,
      closed_at: new Date().toISOString()
    }).catch(err => console.error('SMTP manual closed notification alert failed:', err.message));

    return { success: true, pnl };
  } catch (err) {
    console.error('Manual trade exit failed:', err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = {
  executeTrade,
  manageOpenTrades,
  manualExitTrade
};
