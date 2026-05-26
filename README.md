# DXY Trade Bot

A fully automated, 9-factor confluence strategy trading bot designed specifically for the US Dollar Index (DXY) and related pairs (USDCAD, EURUSD, USDJPY). The bot includes a dynamic dashboard, paper-trading features, and advanced risk management (dynamic lot sizing).

## Features
- **Real-Time Data Integration**: Pulls tick data directly from Kraken for execution.
- **Advanced 9-Factor Confluence Engine**: Uses EMA stacking, RSI corridors, MACD momentum, weekly CPR, Institutional COT data, and Economic news calendar filters.
- **Dynamic Lot Sizing**: Risk percentage-based positioning constrained between `0.01` and `0.10` lots.
- **Backtester**: Test your strategy using real-world historical OHLC data with actual SL/TP hit logic.
- **Full Dashboard**: React-based dashboard to view bot status, manually close trades, and review your trading journal.

## Deploying to Railway (24/7 Operations)

This project is pre-configured to be deployed natively on [Railway.app](https://railway.app/).

1. **Connect your GitHub**: Push this repository to GitHub and create a new project on Railway using this repository.
2. **Environment Variables**: In your Railway project variables, set the following:
   - `BOT_ENABLED=true`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TO` (for email notifications)
   - `DB_PATH=/data/dxy_trading.db`
3. **Add a Persistent Volume**:
   - In Railway, go to the **Volumes** tab and create a new volume.
   - Mount the volume to the path `/data` in your deployment settings. This ensures your SQLite database (where all trades, history, and state are stored) is not lost when the bot redeploys.
4. **Deploy**: Railway will automatically detect the build step (`npm run build` which builds the frontend UI) and the start step (`npm start` which starts the Node server). Your dashboard will be accessible via the public domain provided by Railway.

## Local Development

1. Install dependencies: `npm run setup`
2. Start the development servers: `npm run dev`
3. The dashboard will be available at `http://localhost:5173`.
