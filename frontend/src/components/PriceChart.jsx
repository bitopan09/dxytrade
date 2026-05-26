import React from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine,
  Legend
} from 'recharts';

export default function PriceChart({ candles, activeTrades }) {
  if (!candles || candles.length === 0) {
    return (
      <div className="glass-card" style={{ height: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <h2 style={{ alignSelf: 'flex-start', width: '100%' }}>DXY Spot Index Exchange Chart</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Awaiting Yahoo Finance DXY candles...</p>
      </div>
    );
  }

  // Format data for Recharts (limit to last 100 bars as specified)
  const chartData = candles.slice(-100).map(c => {
    let formattedTime = '—';
    try {
      const date = new Date(c.timestamp);
      formattedTime = date.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' }) + ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      formattedTime = c.timestamp;
    }
    return {
      name: formattedTime,
      close: parseFloat(c.close.toFixed(3)),
      open: parseFloat(c.open.toFixed(3)),
      high: parseFloat(c.high.toFixed(3)),
      low: parseFloat(c.low.toFixed(3))
    };
  });

  // Calculate chart boundaries
  const prices = chartData.map(c => c.close);
  const minPrice = Math.min(...prices) * 0.999;
  const maxPrice = Math.max(...prices) * 1.001;

  // Extract active trade parameters for annotations (first active trade for simplicity)
  const trade = activeTrades && activeTrades.length > 0 ? activeTrades[0] : null;

  return (
    <div className="glass-card" style={{ height: '100%', minHeight: '450px', display: 'flex', flexDirection: 'column' }}>
      <h2>DXY Spot Index Exchange Chart (4H)</h2>
      
      <div style={{ flex: 1, width: '100%', height: '340px', marginTop: '10px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.05)" />
            
            <XAxis 
              dataKey="name" 
              tick={{ fill: 'var(--text-muted)', fontSize: 9 }} 
              stroke="rgba(148, 163, 184, 0.1)"
              dy={10}
            />
            
            <YAxis 
              domain={[minPrice.toFixed(2), maxPrice.toFixed(2)]} 
              tick={{ fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' }} 
              stroke="rgba(148, 163, 184, 0.1)"
              dx={-10}
            />
            
            <Tooltip 
              contentStyle={{ 
                background: 'var(--glass-bg)', 
                borderColor: 'var(--border)', 
                borderRadius: '8px', 
                color: 'white',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                backdropFilter: 'blur(8px)'
              }} 
            />

            <Legend verticalAlign="top" height={36} iconType="circle" />
            
            <Line 
              type="monotone" 
              dataKey="close" 
              name="DXY Close" 
              stroke="url(#chartGlow)" 
              strokeWidth={3} 
              dot={false}
              activeDot={{ r: 6, stroke: 'var(--accent-cyan)', strokeWidth: 2, fill: '#000' }}
            />

            {/* Glowing gradient definitions */}
            <defs>
              <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-cyan)" />
                <stop offset="100%" stopColor="var(--accent-indigo)" />
              </linearGradient>
            </defs>

            {/* ==================== ACTIVE TRADE ANNOTATIONS ==================== */}
            {trade && (
              <ReferenceLine 
                y={trade.entry_price} 
                stroke="var(--accent-cyan)" 
                strokeDasharray="4 4"
                label={{ value: `Entry: ${trade.entry_price.toFixed(3)}`, fill: 'var(--accent-cyan)', position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)' }} 
              />
            )}
            {trade && (
              <ReferenceLine 
                y={trade.stop_loss} 
                stroke="var(--accent-red)" 
                strokeDasharray="4 4"
                label={{ value: `SL: ${trade.stop_loss.toFixed(3)}`, fill: 'var(--accent-red)', position: 'insideBottomLeft', fontSize: 10, fontFamily: 'var(--font-mono)' }} 
              />
            )}
            {trade && (
              <ReferenceLine 
                y={trade.take_profit_1} 
                stroke="var(--accent-emerald)" 
                strokeDasharray="4 4"
                label={{ value: `TP1: ${trade.take_profit_1.toFixed(3)}`, fill: 'var(--accent-emerald)', position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)' }} 
              />
            )}
            {trade && (
              <ReferenceLine 
                y={trade.take_profit_2} 
                stroke="var(--accent-emerald)" 
                strokeDasharray="4 4"
                label={{ value: `TP2: ${trade.take_profit_2.toFixed(3)}`, fill: 'var(--accent-emerald)', position: 'insideTopLeft', fontSize: 10, fontFamily: 'var(--font-mono)' }} 
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* CPR Legend Helper Panel */}
      {trade && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(4, 1fr)', 
          gap: '8px', 
          marginTop: '16px', 
          padding: '10px', 
          background: 'rgba(30, 41, 59, 0.25)', 
          borderRadius: '8px', 
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          border: '1px solid var(--glass-border)'
        }}>
          <div><strong style={{ color: 'var(--accent-cyan)' }}>Entry Price:</strong> {trade.entry_price.toFixed(3)}</div>
          <div><strong style={{ color: 'var(--accent-red)' }}>Stop Loss:</strong> {trade.stop_loss.toFixed(3)}</div>
          <div><strong style={{ color: 'var(--accent-emerald)' }}>TP 1 (1:3):</strong> {trade.take_profit_1.toFixed(3)}</div>
          <div><strong style={{ color: 'var(--accent-emerald)' }}>TP 2 (1:5):</strong> {trade.take_profit_2.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}
