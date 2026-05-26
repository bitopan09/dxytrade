const axios = require('axios');

const NEWS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

/**
 * Fetch weekly high-impact USD events from the ForexFactory JSON proxy feed.
 */
async function fetchEconomicCalendar() {
  try {
    const url = process.env.FF_CALENDAR_RSS || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    const response = await axios.get(url, {
      headers: NEWS_HEADERS,
      timeout: 8000
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Economic calendar response is not a valid JSON array');
    }

    // Filter strictly for USD currency events that have high impact
    return response.data.filter(e => e.currency === 'USD' && e.impact === 'High');
  } catch (error) {
    console.error('ForexFactory economic calendar query failed:', error.message);
    return []; // Return empty array so the bot doesn't freeze, just skips news checks for safety
  }
}

/**
 * Check if the bot should be blocked due to a high-impact USD calendar event.
 * Enforces:
 * - 24-Hour full-day block for top-tier announcements (CPI, FOMC, GDP, NFP, PPI)
 * - 30 minutes before to 60 minutes after for normal USD high-impact news
 */
function isBlackedOut(events, nowUTC) {
  if (!events || events.length === 0) return false;
  const now = new Date(nowUTC);
  
  // ALWAYS block the entire day for these major market movers
  const fullDayBlock = [
    'Non-Farm Payrolls', 
    'FOMC Statement', 
    'Fed Interest Rate Decision', 
    'CPI m/m', 
    'Core CPI m/m',
    'GDP q/q', 
    'PPI m/m'
  ];
  
  for (const event of events) {
    let eventTime;
    
    // Parse ForexFactory ISO timestamp safely (e.g. 2026-05-24T18:30:00-04:00)
    if (event.date) {
      eventTime = new Date(event.date);
    } else {
      const dateStr = event.date || new Date().toISOString().split('T')[0];
      const timeStr = event.time || '00:00';
      eventTime = new Date(`${dateStr}T${timeStr}:00Z`);
    }

    // Skip invalid dates
    if (isNaN(eventTime.getTime())) continue;

    // 1. Check Full-Day Blackouts
    const isMajorEvent = fullDayBlock.some(name => event.title && event.title.includes(name));
    if (isMajorEvent) {
      if (now.toDateString() === eventTime.toDateString()) {
        console.log(`[NEWS FILTER] Gated: Full-day block active for major event: ${event.title}`);
        return true;
      }
    }
    
    // 2. Check Standard 30min-before / 60min-after windows
    const before = new Date(eventTime.getTime() - 30 * 60 * 1000);
    const after = new Date(eventTime.getTime() + 60 * 60 * 1000);
    if (now >= before && now <= after) {
      console.log(`[NEWS FILTER] Gated: Standard window active for high-impact USD event: ${event.title}`);
      return true;
    }
  }
  return false;
}

module.exports = { fetchEconomicCalendar, isBlackedOut };
