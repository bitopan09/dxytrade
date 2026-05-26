import React, { useState } from 'react';
import { manualTrade, userId } from '../services/api';

const ManualTrade = () => {
    const [quantity, setQuantity] = useState(0.15);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false); // Clean error state

    const handleTrade = async (action) => {
        setLoading(true);
        setMessage('');
        try {
            const result = await manualTrade(action, quantity);
            setIsError(false);
            setMessage(result.message || `Successfully executed ${action} at ${result.trade?.entryPrice?.toFixed(4)}`);
        } catch (error) {
            setIsError(true);
            setMessage(error.error || error.reason || `Failed to execute ${action}`);
        } finally {
            setLoading(false);
            setTimeout(() => setMessage(''), 4000);
        }
    };

    return (
        <div className="manual-trade-container">
            <h2>Paper Trade (User: {userId.substring(0, 12)}...)</h2>
            <div className="trade-controls">
                <div className="input-group">
                    <label>Quantity (Lots)</label>
                    <input 
                        type="number" 
                        step="0.01" 
                        min="0.01" 
                        max="100"
                        value={quantity} 
                        onChange={(e) => setQuantity(parseFloat(e.target.value) || 0.15)}
                    />
                </div>
                <div className="action-buttons">
                    <button 
                        className="btn-buy" 
                        onClick={() => handleTrade('BUY')}
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : 'BUY'}
                    </button>
                    <button 
                        className="btn-sell" 
                        onClick={() => handleTrade('SELL')}
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : 'SELL'}
                    </button>
                </div>
            </div>
            {message && <div className={`trade-message ${isError ? 'error' : 'success'}`}>{message}</div>}
        </div>
    );
};

export default ManualTrade;
