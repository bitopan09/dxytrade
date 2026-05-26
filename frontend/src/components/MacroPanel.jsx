import React from 'react';

export default function MacroPanel({ cot, status }) {
  const getBiasLabel = (net) => {
    if (!net) return 'Neutral';
    return net > 0 ? '🟢 Bullish USD (Net Long)' : '🔴 Bearish USD (Net Short)';
  };

  const getWoWChangeLabel = (change) => {
    if (!change) return 'Unchanged';
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toLocaleString()} contracts`;
  };

  const formatEventTime = (isoString) => {
    if (!isoString) return 'All Day';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }) + ' IST';
    } catch {
      return 'All Day';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* COT Panel */}
      <div className="glass-card">
        <h2>CFTC Institutional COT Bias</h2>
        
        {cot && cot.week_date ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
            <div style={{ padding: '10px', background: 'rgba(30, 41, 59, 0.3)', borderRadius: '8px', borderLeft: '3px solid var(--accent-indigo)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Weekly Sentiment Bias</div>
              <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '4px' }}>
                {getBiasLabel(cot.net_noncommercial)}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Report Week:</span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{cot.week_date}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Long Contracts:</span>
                <span style={{ color: 'var(--text-primary)' }}>{cot.long_noncommercial?.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Short Contracts:</span>
                <span style={{ color: 'var(--text-primary)' }}>{cot.short_noncommercial?.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Net Positions:</span>
                <span style={{ color: cot.net_noncommercial > 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', fontWeight: 'bold' }}>
                  {cot.net_noncommercial?.toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--glass-border)', paddingTop: '6px', marginTop: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>WoW Change:</span>
                <span style={{ color: cot.change_net > 0 ? 'var(--accent-emerald)' : 'var(--accent-red)', fontWeight: 'bold' }}>
                  {getWoWChangeLabel(cot.change_net)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No weekly COT data loaded.</p>
        )}
      </div>

      {/* Economic News Calendar Panel */}
      <div className="glass-card">
        <h2>USD High-Impact Announcements</h2>
        
        {status && status.cachedNews && status.cachedNews.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
            {status.cachedNews.map((event, i) => (
              <div key={i} style={{ 
                padding: '10px', 
                background: 'rgba(239, 68, 68, 0.05)', 
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderLeft: '3px solid var(--accent-red)',
                borderRadius: '8px',
                fontSize: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                  <span>{event.title}</span>
                  <span style={{ color: 'var(--accent-red)', fontSize: '10px', textTransform: 'uppercase' }}>HIGH IMPACT</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  <span>Date: {event.date ? event.date.split('T')[0] : '—'}</span>
                  <span>Time: {formatEventTime(event.date || event.time)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No USD high-impact news active this week.</p>
        )}
      </div>
    </div>
  );
}
