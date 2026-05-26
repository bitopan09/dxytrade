import React, { useState, useEffect } from 'react';
import { fetchTrades, userId } from '../services/api';
import { formatTimeIST } from '../utils/timeFormatter';
import * as XLSX from 'xlsx';

const TradeJournal = () => {
    const [trades, setTrades] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTradesData = async () => {
            try {
                setLoading(true);
                const data = await fetchTrades();
                setTrades(data);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching trades:', error);
                setLoading(false);
            }
        };

        fetchTradesData();
        // Refresh trades every 30 seconds
        const interval = setInterval(fetchTradesData, 30000);
        return () => clearInterval(interval);
    }, []);

    const downloadXlsx = () => {
        const ws = XLSX.utils.json_to_sheet(trades.map(t => ({
            ID: t.id,
            'Opened At': t.opened_at || t.timestamp,
            'Closed At': t.closed_at,
            Action: t.action,
            Quantity: t.quantity,
            'Entry Price': t.entry_price,
            'Exit Price': t.exit_price,
            'Stop Loss': t.stop_loss,
            'Take Profit 1': t.take_profit_1,
            'Take Profit 2': t.take_profit_2,
            Status: t.status,
            'P&L': t.pnl,
            'Confluence Reason': t.entry_reason,
            'Exit Reason': t.exit_reason
        })));
        
        // Force exactly 5 decimals as literal strings for all price columns (F through J)
        for (let key in ws) {
            if (key.match(/^[F-J]\d+$/) && ws[key].v && !isNaN(ws[key].v)) {
                ws[key].t = 's';
                ws[key].v = parseFloat(ws[key].v).toFixed(5);
            }
            if (key.match(/^L\d+$/) && ws[key].v && !isNaN(ws[key].v)) {
                ws[key].t = 's';
                ws[key].v = '$' + parseFloat(ws[key].v).toFixed(2);
            }
        }
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Journal");
        XLSX.writeFile(wb, "trade_journal.xlsx");
    };

    if (loading) {
        return (
            <div className="journal-container">
                <h2>Trade Journal</h2>
                <p>Loading trade data...</p>
            </div>
        );
    }

    return (
        <div className="journal-container">
            <div className="journal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ marginBottom: '4px' }}>Trade Journal (Paper Trading)</h2>
                    <small style={{ color: '#94a3b8', fontSize: '12px' }}>User: {userId.substring(0, 16)}...</small>
                </div>
                <button onClick={downloadXlsx} className="btn-export" style={{cursor: 'pointer'}}>
                    📥 Export to Excel (.xlsx)
                </button>
            </div>
            {trades.length === 0 ? (
                <p>No paper trades recorded yet.</p>
            ) : (
                <table className="trade-table">
                    <thead>
                        <tr>
                            <th>Date (IST)</th>
                            <th>Action</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>SL / TP1 / TP2</th>
                            <th>Status</th>
                            <th>Qty</th>
                            <th>P&L</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trades.map(trade => (
                            <tr key={trade.id}>
                                <td>{formatTimeIST(trade.opened_at || trade.timestamp, 'date-time')}</td>
                                <td><strong>{trade.action}</strong></td>
                                <td>${trade.entry_price?.toFixed(5) || 'N/A'}</td>
                                <td>{trade.exit_price ? '$'+trade.exit_price.toFixed(5) : 'Open'}</td>
                                <td style={{fontSize: '0.85em'}}>
                                    SL: {trade.stop_loss !== undefined ? trade.stop_loss.toFixed(5) : (trade.sl ? trade.sl.toFixed(5) : '-')} <br/>
                                    TP1: {trade.take_profit_1 !== undefined ? trade.take_profit_1.toFixed(5) : (trade.tp1 ? trade.tp1.toFixed(5) : '-')} <br/>
                                    TP2: {trade.take_profit_2 !== undefined ? trade.take_profit_2.toFixed(5) : (trade.tp2 ? trade.tp2.toFixed(5) : '-')}
                                </td>
                                <td><span className={`status-${trade.status?.toLowerCase() || 'open'}`}>{trade.status || 'OPEN'}</span></td>
                                <td>{trade.quantity}</td>
                                <td className={trade.pnl >= 0 ? 'profit' : 'loss'}>
                                    {trade.pnl !== null ? '$' + trade.pnl.toFixed(2) : 'Open'}
                                </td>
                                <td>{trade.exit_reason || (['CLOSED', 'TP1', 'TP2', 'STOPPED'].includes(trade.status) ? trade.status : '-')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default TradeJournal;