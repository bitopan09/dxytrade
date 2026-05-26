const axios = require('axios');

async function run() {
    const url = 'https://api.exchange.coinbase.com/products/USDC-CAD/candles?granularity=86400';
    const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    
    const quotes = response.data.map(c => ({
      date: new Date(c[0] * 1000),
      open: parseFloat(c[3]),
      high: parseFloat(c[2]),
      low: parseFloat(c[1]),
      close: parseFloat(c[4])
    })).reverse();
    
    const totalTrades = Math.max(12, Math.floor(quotes.length / 5));
    
    function runSim(isAggressive) {
        let wins = 0;
        let equity = 100.00;
        let maxDrawdown = 0;
        let peakEquity = 100.00;
        
        let tradeId = 1;
        
        for (let i = 10; i < quotes.length - 2; i += Math.floor(quotes.length / totalTrades) || 1) {
          if (tradeId > totalTrades) break;
          
          let baseCapital = 100;
          let tempBase = 100;
          let multiplier = 1;
          
          if (equity >= 200) {
              while (tempBase * 2 <= equity) {
                  tempBase *= 2;
                  multiplier *= 2;
              }
              baseCapital = tempBase;
          }
          
          const candle = quotes[i];
          const entryPrice = candle.open;
          
          let quantity;
          if (isAggressive) {
              quantity = 0.15 * multiplier; // Aggressive scale
          } else {
              const riskAmount = baseCapital * 0.10;
              const slDistance = 0.0035;
              const quantityRaw = (riskAmount * entryPrice) / (slDistance * 100000);
              quantity = parseFloat(quantityRaw.toFixed(2)) || 0.01;
          }
          
          // Use seeded random or consistent win/loss for identical trade sequences
          const isWin = (i % 2 === 0) || (i % 3 === 0); // 66% win rate roughly
          if (isWin) wins++;
          
          const prevCandle = quotes[i - 1];
          const isBuy = candle.open > prevCandle.close;
          
          const volatility = isWin 
            ? (0.0040) // Avg win distance
            : -(0.0035); // Avg loss distance
          
          const exitPrice = isBuy 
            ? parseFloat((entryPrice + volatility).toFixed(5))
            : parseFloat((entryPrice - volatility).toFixed(5));
            
          const pointDiff = isBuy ? exitPrice - entryPrice : entryPrice - exitPrice;
          const conversionRate = exitPrice; 
          const pnl = parseFloat(((pointDiff * quantity * 100000) / conversionRate).toFixed(2));
          
          equity = parseFloat((equity + pnl).toFixed(2));
          
          if (equity > peakEquity) peakEquity = equity;
          const dd = (peakEquity - equity) / peakEquity;
          if (dd > maxDrawdown) maxDrawdown = dd;
          
          if (equity <= 0) {
             equity = 0;
             break; // Blown account
          }
          
          tradeId++;
        }
        return { equity, maxDrawdown, wins, totalTrades: tradeId - 1 };
    }
    
    const safe = runSim(false);
    const agg = runSim(true);
    
    console.log("=== 10% Dynamic Scaling (0.04 Lot Base) ===");
    console.log(`Final Equity: $${safe.equity.toFixed(2)}`);
    console.log(`Max Drawdown: ${(safe.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Win Rate: ${((safe.wins / safe.totalTrades)*100).toFixed(2)}%`);
    console.log("\n=== 0.15 Lot Aggressive Scaling ===");
    console.log(`Final Equity: $${agg.equity.toFixed(2)}`);
    console.log(`Max Drawdown: ${(agg.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Win Rate: ${((agg.wins / agg.totalTrades)*100).toFixed(2)}%`);
}
run();
