import React, { useState, useEffect } from 'react';
import { fetchBalance, fetchPrice, userId } from '../services/api';

const BalanceTracker = () => {
    const [balanceData, setBalanceData] = useState(null);
    const [currentPrice, setCurrentPrice] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (loading) setLoading(true);
                const [balance, price] = await Promise.all([
                    fetchBalance(),
                    fetchPrice()
                ]);
                setBalanceData(balance);
                setCurrentPrice(price.price || 0);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching balance data:', error);
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 10000); // Update every 10 seconds
        return () => clearInterval(interval);
    }, []);

    if (loading && !balanceData) {
        return (
            <div className="balance-container">
                <h2>Balance Tracker</h2>
                <p>Loading balance data...</p>
            </div>
        );
    }

    if (!balanceData) {
        return (
            <div className="balance-container">
                <h2>Balance Tracker</h2>
                <p>No balance data available</p>
            </div>
        );
    }

    const usd_balance = balanceData.balance !== undefined 
      ? balanceData.balance 
      : (balanceData.usd_balance !== undefined ? balanceData.usd_balance : 50.00);
    const initialCapital = 50.00;
    const roi = ((usd_balance - initialCapital) / initialCapital) * 100;

    return (
        <div className="balance-container">
            <h2>Balance Tracker</h2>
            <div className="user-id-small" style={{ fontSize: '0.75em', color: '#64748b', marginBottom: '10px' }}>
                User: {userId.substring(0, 12)}...
            </div>
            <div className="balance-details">
                <div className="balance-item">
                    <h3>Initial Capital</h3>
                    <p>${initialCapital.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="balance-item">
                    <h3>Net Cash Balance</h3>
                    <p>${usd_balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="balance-item">
                    <h3>Net Return (ROI)</h3>
                    <p style={{ color: roi >= 0 ? '#10b981' : '#ef4444' }}>
                        {roi >= 0 ? '+' : ''}{roi.toFixed(3)}%
                    </p>
                    <span style={{ fontSize: '0.8em', color: '#718096' }}>Based on USDCAD spot ticks</span>
                </div>
            </div>
        </div>
    );
};

export default BalanceTracker;