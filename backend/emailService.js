const nodemailer = require('nodemailer');

// Set up transporter with safe mock fallback if credentials are unconfigured
let transporter = null;
let emailEnabled = false;

try {
  if (process.env.EMAIL_USER && process.env.EMAIL_USER !== 'your@gmail.com' && process.env.EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    emailEnabled = true;
    console.log('[EMAIL SERVICE] SMTP configured successfully and active.');
  } else {
    console.log('[EMAIL SERVICE] Email credentials not configured or set to defaults. Alerts will run in MOCK mode.');
  }
} catch (err) {
  console.error('[EMAIL SERVICE] Failed to initialize Nodemailer transporter:', err.message);
}

/**
 * Send structured HTML trade execution alerts to the user.
 */
async function sendTradeEmail(type, data) {
  if (process.env.SEND_EMAIL_ON_TRADE !== 'true' || !emailEnabled || !transporter) {
    console.log(`[EMAIL SERVICE] [MOCK SEND] Trade Alert (${type}):`, JSON.stringify(data));
    return;
  }

  const subjects = {
    BUY:    '🟢 DXY BUY Signal Executed',
    SELL:   '🔴 DXY SELL Signal Executed',
    CLOSED: '⚪ DXY Trade Closed',
    ERROR:  '⚠️ DXY Bot Error',
    TEST:   '🔔 DXY Bot Email Test',
    SUMMARY: '📊 DXY Bot Daily Performance Summary'
  };

  try {
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const notifyEmail = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px; color: #ffffff; text-align: center;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">${subjects[type] || 'DXY Trading Bot Notification'}</h2>
          <p style="margin: 6px 0 0; font-size: 13px; color: #93c5fd; font-family: monospace;">Time: ${istTime} IST</p>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <table cellpadding="8" style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 13px; border: 1px solid #f1f5f9;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th align="left" style="padding: 10px; color: #475569;">Key Metric</th>
                <th align="left" style="padding: 10px; color: #475569;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(data).map(([k, v]) => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px; color: #64748b; font-weight: bold;">${k.toUpperCase().replace(/_/g, ' ')}</td>
                  <td style="padding: 10px; color: #0f172a; word-break: break-all;">${v}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
            <p style="margin: 0; font-weight: bold;">DXY Automated Confluence Terminal</p>
            <p style="margin: 4px 0 0;">Paper Trading Mode Only · Designed for US Dollar Index (DXY)</p>
          </div>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"DXY Bot" <${process.env.EMAIL_USER}>`,
      to: notifyEmail,
      subject: subjects[type] || 'DXY Bot Performance Update',
      html
    });
    console.log(`[EMAIL SERVICE] Trade Alert email sent successfully: ${type}`);
  } catch (error) {
    console.error('[EMAIL SERVICE] Failed to send email alert:', error.message);
  }
}

/**
 * Send midnight performance summary emails detailing profit growth.
 */
async function sendDailySummaryEmail(trades, lastPrice) {
  if (process.env.SEND_DAILY_SUMMARY !== 'true' || !emailEnabled || !transporter) {
    console.log(`[EMAIL SERVICE] [MOCK SEND] Daily Summary Alert. Trades: ${trades.length}, Last Price: ${lastPrice}`);
    return;
  }

  try {
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winCount = trades.filter(t => t.pnl > 0).length;
    const lossCount = trades.filter(t => t.pnl < 0).length;

    await sendTradeEmail('SUMMARY', {
      summary_date: new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
      total_trades_today: trades.length,
      win_trades: winCount,
      loss_trades: lossCount,
      total_pnl_usd: `$${totalPnl.toFixed(2)}`,
      last_dxy_price: lastPrice
    });
  } catch (error) {
    console.error('[EMAIL SERVICE] Failed to generate daily summary email:', error.message);
  }
}

module.exports = { sendTradeEmail, sendDailySummaryEmail };
