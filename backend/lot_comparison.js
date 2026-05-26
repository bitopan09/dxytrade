const axios = require('axios');

async function run() {
    const url = 'https://api.exchange.coinbase.com/products/USDC-CAD/candles?granularity=86400';
    const resp = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    const quotes = resp.data.map(c => ({
        date: new Date(c[0] * 1000), open: parseFloat(c[3]),
        high: parseFloat(c[2]), low: parseFloat(c[1]), close: parseFloat(c[4])
    })).reverse();

    function seededRandom(seed) {
        let s = seed;
        return () => { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 0xFFFFFFFF; };
    }

    function simulate(label, useFixedLot) {
        const rng = seededRandom(42);
        const totalTrades = Math.max(12, Math.floor(quotes.length / 5));
        let equity = 50, peakEquity = 50, maxDD = 0;
        let wins = 0, losses = 0, blown = false;
        const curve = [{ t: 0, eq: 50 }];
        let consecutiveLosses = 0, cooldown = 0;

        for (let i = 10, tid = 0; i < quotes.length - 2 && tid < totalTrades; i += Math.floor(quotes.length / totalTrades) || 1) {
            if (cooldown > 0) { cooldown--; continue; }
            if (equity <= 50 && tid > 0) { blown = true; break; }

            let base = 50, tmp = 50;
            if (equity >= 100) { while (tmp * 2 <= equity) tmp *= 2; base = tmp; }
            const maxRiskable = equity - 50;

            const candle = quotes[i];
            const entry = candle.open;
            const prev = quotes[i - 1];
            const isBuy = entry > prev.close;
            const slDist = 0.00245;

            let quantity;
            if (useFixedLot) {
                quantity = 0.15;
            } else {
                const riskAmt = Math.min(base * 0.20, maxRiskable);
                quantity = parseFloat(((riskAmt * entry) / (slDist * 100000)).toFixed(2)) || 0.01;
            }

            // Risk in USD for this trade
            const riskUSD = parseFloat(((slDist * quantity * 100000) / entry).toFixed(2));

            const isWin = rng() < 0.70;
            const hitsTP2 = rng() < 0.30;
            const vol = isWin ? (hitsTP2 ? slDist * 4.0 : slDist * 2.0) : -slDist;
            const exitPrice = isBuy ? entry + vol : entry - vol;
            const pnl = parseFloat(((vol * quantity * 100000) / Math.abs(exitPrice)).toFixed(2));

            equity = parseFloat((equity + pnl).toFixed(2));
            tid++;

            if (pnl > 0) { wins++; consecutiveLosses = 0; }
            else { losses++; consecutiveLosses++; if (consecutiveLosses >= 2) { cooldown = 2; consecutiveLosses = 0; } }

            if (equity > peakEquity) peakEquity = equity;
            const dd = (peakEquity - equity) / peakEquity;
            if (dd > maxDD) maxDD = dd;
            curve.push({ t: tid, eq: equity, lot: quantity, risk: riskUSD, pnl });
            if (equity <= 0) { equity = 0; blown = true; break; }
        }

        console.log(`\n${'='.repeat(70)}`);
        console.log(`  ${label}`);
        console.log(`${'='.repeat(70)}`);
        console.log(`  Initial:       $50.00`);
        console.log(`  Final Equity:  $${equity.toFixed(2)}${blown ? '  ⚠️  HIT EQUITY FLOOR' : ''}`);
        console.log(`  Total Return:  +${((equity - 50) / 50 * 100).toFixed(1)}%`);
        console.log(`  Win Rate:      ${((wins / (wins + losses)) * 100).toFixed(1)}% (${wins}W / ${losses}L)`);
        console.log(`  Max Drawdown:  ${(maxDD * 100).toFixed(1)}%`);
        console.log(`  Equity Floor:  ${blown ? '🔴 TRIGGERED — Trading stopped' : '🟢 Never hit'}`);
        console.log(`\n  Trade-by-Trade:`);
        console.log(`  ${'#'.padEnd(4)} ${'Equity'.padEnd(12)} ${'Lot'.padEnd(8)} ${'Risk$'.padEnd(10)} ${'PnL'.padEnd(10)}`);
        console.log(`  ${'-'.repeat(50)}`);
        curve.forEach(p => {
            if (p.t === 0) {
                console.log(`  ${String(p.t).padEnd(4)} $${p.eq.toFixed(2).padStart(8)}     (start)`);
            } else {
                const pnlStr = p.pnl >= 0 ? `+$${p.pnl.toFixed(2)}` : `-$${Math.abs(p.pnl).toFixed(2)}`;
                console.log(`  ${String(p.t).padEnd(4)} $${p.eq.toFixed(2).padStart(8)}   ${String(p.lot).padEnd(8)} $${p.risk.toFixed(2).padStart(7)}   ${pnlStr}`);
            }
        });
    }

    simulate('DYNAMIC LOT (20% Tiered Risk — Current Strategy)', false);
    simulate('FIXED 0.15 LOT (with $50 Equity Floor)', true);
}
run();
