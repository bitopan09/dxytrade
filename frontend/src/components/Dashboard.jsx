import React from 'react';

export default function Dashboard({ status, balance, onToggleBot, onTestEmail, emailTesting }) {
  if (!status) {
    return (
      <div className="status-cards-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="metric-card" style={{ minHeight: '94px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="metric-label">Loading Dashboard...</div>
            <div className="metric-value">—</div>
          </div>
        ))}
      </div>
    );
  }

  const formatIST = (isoString) => {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }) + ' IST';
    } catch {
      return '—';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="status-cards-grid">
        {/* Metric 1: Simulated USD Balance */}
        <div className="metric-card">
          <div className="metric-label">Simulated Account Balance</div>
          <div className="metric-value emerald">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Metric 2: Live Direct DXY Price */}
        <div className="metric-card">
          <div className="metric-label">Live Direct DXY Price</div>
          <div className="metric-value">
            {status.price ? status.price.toFixed(3) : (status.lastPrice ? status.lastPrice.toFixed(3) : '104.500')}
          </div>
        </div>

        {/* Metric 3: Daily Trades Counter */}
        <div className="metric-card">
          <div className="metric-label">Trades Executed Today</div>
          <div className="metric-value">
            {status.dailyTrades ?? (status.dailyTradeCount ?? 0)} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>/ 1 limit</span>
          </div>
        </div>

        {/* Metric 4: Consecutive Losses */}
        <div className="metric-card">
          <div className="metric-label">Consecutive Losses</div>
          <div className="metric-value red">
            {status.consecutiveLosses ?? 0}
          </div>
        </div>

        {/* Metric 5: 24H Circuit Breaker */}
        <div className="metric-card">
          <div className="metric-label">Circuit Breaker Cooldown</div>
          <div className="metric-value" style={{ color: status.cooldownActive ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: status.cooldownActive ? '20px' : '24px' }}>
            {status.cooldownActive ? '🔴 ACTIVE (24H)' : '🟢 Off'}
          </div>
        </div>

        {/* Metric 6: Last Analysis Cycle */}
        <div className="metric-card">
          <div className="metric-label">Last Analysis Tick</div>
          <div className="metric-value" style={{ fontSize: '16px', paddingTop: '6px' }}>
            {formatIST(status.lastAnalysis)}
          </div>
        </div>
      </div>

      {/* Bot Controls Panel */}
      <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Bot Orchestrator Status</span>
            <span style={{ fontSize: '15px', fontWeight: 'bold' }}>
              {status.enabled ? (
                <span className="status-online" style={{ marginTop: '4px' }}>
                  <span className="status-dot online"></span> Bot is Online (15m cycle active)
                </span>
              ) : (
                <span className="status-offline" style={{ marginTop: '4px' }}>
                  <span className="status-dot offline"></span> Bot is Offline (Paused)
                </span>
              )}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="btn-primary" 
            style={{ 
              background: status.enabled ? 'var(--gradient-red)' : 'var(--gradient-green)',
              boxShadow: status.enabled ? '0 4px 12px rgba(239, 68, 68, 0.25)' : '0 4px 12px rgba(16, 185, 129, 0.25)'
            }}
            onClick={onToggleBot}
          >
            {status.enabled ? 'Stop Bot Operations' : 'Start Bot Operations'}
          </button>
          
          <button 
            className="btn-primary" 
            style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', boxShadow: 'none', border: '1px solid var(--glass-border)' }}
            onClick={onTestEmail}
            disabled={emailTesting}
          >
            {emailTesting ? 'Queuing SMTP Test...' : 'Test SMTP Mailer'}
          </button>
        </div>
      </div>
    </div>
  );
}
