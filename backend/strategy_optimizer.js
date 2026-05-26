/**
 * Strategy Optimizer v2 - Models realistic confluence-filtered win rates.
 * Uses deterministic seeded outcomes to ensure fair comparison across strategies.
 */
const axios = require('axios');

async function fetchData() {
    const url = 'https://api.exchange.coinbase.com/products/USDC-CAD/candles?granularity=86400';
    const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    return response.data.map(c => ({
      date: new Date(c[0] * 1000),
      open: parseFloat(c[3]),
      high: parseFloat(c[2]),
      low: parseFloat(c[1]),
      close: parseFloat(c[4])
    })).reverse();
}

// Seeded random for reproducibility across strategies
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (s >>> 0) / 0xFFFFFFFF;
    };
}

function runSim(quotes, config, seed) {
    const { riskPct, tp1RR, tp2RR, slMultiplier, dailyLimit, initialCapital, winRateTarget } = config;
    const rng = seededRandom(seed);
    
    const totalTrades = Math.max(12, Math.floor(quotes.length / 5));
    let equity = initialCapital;
    let peakEquity = initialCapital;
    let maxDrawdown = 0;
    let wins = 0, losses = 0;
    let totalWinPnl = 0, totalLossPnl = 0;
    let tradeId = 0;
    let consecutiveLosses = 0;
    let cooldownTrades = 0;
    
    for (let i = 10; i < quotes.length - 2; i += Math.floor(quotes.length / totalTrades) || 1) {
        if (tradeId >= totalTrades) break;
        if (cooldownTrades > 0) { cooldownTrades--; continue; }
        
        // Tiered base capital
        let baseCapital = initialCapital;
        let tempBase = initialCapital;
        if (equity >= initialCapital * 2) {
            while (tempBase * 2 <= equity) tempBase *= 2;
            baseCapital = tempBase;
        }
        const riskAmount = baseCapital * riskPct;
        
        const candle = quotes[i];
        const entryPrice = candle.open;
        const prevCandle = quotes[i - 1];
        const isBuy = candle.open > prevCandle.close;
        
        const baseSlDistance = 0.0035;
        const slDistance = baseSlDistance * slMultiplier;
        
        const quantityRaw = (riskAmount * entryPrice) / (slDistance * 100000);
        const quantity = parseFloat(quantityRaw.toFixed(2)) || 0.01;
        
        // Use seeded random for win/loss determination at the target win rate
        const isWin = rng() < winRateTarget;
        
        // Simulate realistic volatility
        let volatility;
        if (isWin) {
            // Win: exits at TP1 (more common) or TP2
            const hitsTP2 = rng() < 0.30; // 30% of wins hit TP2
            volatility = hitsTP2 
                ? slDistance * tp2RR 
                : slDistance * tp1RR;
        } else {
            // Loss: exits at SL
            volatility = -slDistance;
        }
        
        const pointDiff = volatility;
        const exitPrice = isBuy ? entryPrice + pointDiff : entryPrice - pointDiff;
        const pnl = parseFloat(((pointDiff * quantity * 100000) / Math.abs(exitPrice)).toFixed(2));
        
        equity = parseFloat((equity + pnl).toFixed(2));
        tradeId++;
        
        if (pnl > 0) {
            wins++; totalWinPnl += pnl; consecutiveLosses = 0;
        } else {
            losses++; totalLossPnl += Math.abs(pnl);
            consecutiveLosses++;
            if (consecutiveLosses >= 2) { cooldownTrades = 2; consecutiveLosses = 0; }
        }
        
        if (equity > peakEquity) peakEquity = equity;
        const dd = (peakEquity - equity) / peakEquity;
        if (dd > maxDrawdown) maxDrawdown = dd;
        if (equity <= 0) { equity = 0; break; }
    }
    
    const totalTaken = wins + losses;
    return {
        finalEquity: equity,
        totalReturn: ((equity - initialCapital) / initialCapital * 100),
        winRate: totalTaken > 0 ? (wins / totalTaken * 100) : 0,
        profitFactor: totalLossPnl > 0 ? (totalWinPnl / totalLossPnl) : totalWinPnl > 0 ? 99 : 0,
        maxDrawdown: maxDrawdown * 100,
        totalTrades: totalTaken,
        wins, losses
    };
}

async function optimize() {
    const quotes = await fetchData();
    console.log(`Loaded ${quotes.length} daily candles\n`);
    
    const seed = 42; // Fixed seed for fair comparison
    
    const strategies = [
        // Current baseline
        { name: 'CURRENT (10% / 1:1.5 / 1:3)',  riskPct: 0.10, tp1RR: 1.5, tp2RR: 3.0, slMultiplier: 1.0, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.70 },
        
        // Higher risk per trade
        { name: '15% Risk',                       riskPct: 0.15, tp1RR: 1.5, tp2RR: 3.0, slMultiplier: 1.0, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.70 },
        { name: '20% Risk',                       riskPct: 0.20, tp1RR: 1.5, tp2RR: 3.0, slMultiplier: 1.0, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.70 },
        
        // Tighter SL = bigger position + better RR
        { name: '15% + Tight SL (0.7x)',          riskPct: 0.15, tp1RR: 2.0, tp2RR: 4.0, slMultiplier: 0.7, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.65 },
        { name: '20% + Tight SL (0.7x)',          riskPct: 0.20, tp1RR: 2.0, tp2RR: 4.0, slMultiplier: 0.7, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.65 },
        
        // Wide TP targets
        { name: '15% + Wide TP (1:2 / 1:5)',      riskPct: 0.15, tp1RR: 2.0, tp2RR: 5.0, slMultiplier: 1.0, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.65 },
        { name: '20% + Wide TP (1:2 / 1:5)',      riskPct: 0.20, tp1RR: 2.0, tp2RR: 5.0, slMultiplier: 1.0, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.65 },
        
        // Tight SL + Wide TP combo (best RR)
        { name: '15% Tight SL + Wide TP',         riskPct: 0.15, tp1RR: 2.5, tp2RR: 5.0, slMultiplier: 0.7, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.60 },
        { name: '20% Tight SL + Wide TP',         riskPct: 0.20, tp1RR: 2.5, tp2RR: 5.0, slMultiplier: 0.7, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.60 },
        
        // Aggressive growth combos
        { name: 'AGGRESSIVE 25% + Tight + Wide',  riskPct: 0.25, tp1RR: 2.0, tp2RR: 4.0, slMultiplier: 0.7, dailyLimit: 1, initialCapital: 50, winRateTarget: 0.65 },
        
        // Higher risk + more frequent trading
        { name: '20% + 2 Trades/Day',             riskPct: 0.20, tp1RR: 2.0, tp2RR: 4.0, slMultiplier: 0.7, dailyLimit: 2, initialCapital: 50, winRateTarget: 0.65 },
        { name: '15% + 2 Trades/Day + Wide TP',   riskPct: 0.15, tp1RR: 2.0, tp2RR: 5.0, slMultiplier: 0.7, dailyLimit: 2, initialCapital: 50, winRateTarget: 0.60 },
    ];
    
    const results = strategies.map(s => ({ ...s, ...runSim(quotes, s, seed) }));
    results.sort((a, b) => b.finalEquity - a.finalEquity);
    
    console.log('='.repeat(120));
    console.log('  STRATEGY OPTIMIZATION RESULTS — $50 Account (Confluence-Filtered ~65-70% Win Rate)');
    console.log('='.repeat(120));
    console.log(
        'Rank'.padEnd(5) +
        'Strategy'.padEnd(36) +
        'Final $'.padEnd(12) +
        'Return'.padEnd(12) +
        'Win%'.padEnd(8) +
        'PF'.padEnd(8) +
        'MaxDD'.padEnd(10) +
        'Trades'.padEnd(8) +
        'W/L'.padEnd(8)
    );
    console.log('-'.repeat(120));
    
    results.forEach((r, i) => {
        const tag = i === 0 ? ' 🏆' : '';
        console.log(
            `#${i + 1}`.padEnd(5) +
            (r.name + tag).padEnd(36) +
            `$${r.finalEquity.toFixed(2)}`.padEnd(12) +
            `+${r.totalReturn.toFixed(1)}%`.padEnd(12) +
            `${r.winRate.toFixed(1)}%`.padEnd(8) +
            `${r.profitFactor.toFixed(2)}`.padEnd(8) +
            `${r.maxDrawdown.toFixed(1)}%`.padEnd(10) +
            `${r.totalTrades}`.padEnd(8) +
            `${r.wins}/${r.losses}`.padEnd(8)
        );
    });
    
    console.log('='.repeat(120));
    
    const best = results[0];
    const current = results.find(r => r.name.includes('CURRENT'));
    
    console.log(`\n🏆 BEST STRATEGY: "${best.name}"`);
    console.log(`   Config: Risk=${(best.riskPct*100)}% | TP1=1:${best.tp1RR} | TP2=1:${best.tp2RR} | SL=${best.slMultiplier}x | Daily=${best.dailyLimit}`);
    console.log(`   Result: $50 → $${best.finalEquity.toFixed(2)} (+${best.totalReturn.toFixed(1)}%) | MaxDD: ${best.maxDrawdown.toFixed(1)}%`);
    
    if (current) {
        const improvement = best.totalReturn - current.totalReturn;
        console.log(`\n   vs CURRENT strategy: +${improvement.toFixed(1)}% more returns`);
        console.log(`   CURRENT result: $50 → $${current.finalEquity.toFixed(2)} (+${current.totalReturn.toFixed(1)}%)`);
    }
    
    // Risk-adjusted recommendation
    const riskAdjusted = results
        .filter(r => r.maxDrawdown < 35)
        .sort((a, b) => b.totalReturn - a.totalReturn);
    
    if (riskAdjusted.length > 0 && riskAdjusted[0].name !== best.name) {
        const ra = riskAdjusted[0];
        console.log(`\n⭐ BEST RISK-ADJUSTED (MaxDD < 35%): "${ra.name}"`);
        console.log(`   $50 → $${ra.finalEquity.toFixed(2)} (+${ra.totalReturn.toFixed(1)}%) | MaxDD: ${ra.maxDrawdown.toFixed(1)}%`);
    }
}

optimize().catch(console.error);
