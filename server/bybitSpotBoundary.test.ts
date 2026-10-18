import { describe, expect, it } from 'vitest';
import { buildSpotPerformance } from './bybitSpotLedger';
import type { SpotExecution, SpotInventoryChange, SpotPerformanceInput } from '../shared/bybitSpot';

const day = (n: number) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
function fill(id: string, side: 'Buy' | 'Sell', date: number, quantity: string, price: string, value: string, fee: string, feeCurrency: string): SpotExecution {
  return { id, order_id: id, order_link_id: null, timestamp: day(date), symbol: 'BTCUSDT',
    base_coin: 'BTC', quote_coin: 'USDT', side, quantity, price, quote_value: value,
    fee, fee_currency: feeCurrency, fee_currency_source: 'reported', extra_fees_unknown: false };
}
function movement(id: string, date: number, change: string, after: string, trade?: string): SpotInventoryChange {
  return { id, timestamp: day(date), coin: 'BTC', change, balance_after: after,
    type: trade ? 'TRADE' : 'TRANSFER_OUT', category: trade ? 'spot' : '',
    trade_id: trade || null, order_id: trade || null };
}

function input(): SpotPerformanceInput {
  return {
    executions: [
      fill('buy-old', 'Buy', 2, '0.02000001', '50000', '1000.0005', '0.00002000001', 'BTC'),
      fill('sell-old', 'Sell', 3, '0.01998', '50000', '999', '0.999', 'USDT'),
      fill('buy-new', 'Buy', 5, '1', '100', '100', '0.001', 'BTC'),
    ],
    movements: [movement('old-opening-out', 1, '-0.1', '0'),
      movement('buy-old-log', 2, '0.01998001', '0.01998001', 'buy-old'),
      movement('sell-old-log', 3, '-0.01998', '0.00000001', 'sell-old'),
      // Reported residual is 1e-8; precise remaining bought units are 9.99e-9.
      // This transfer must not turn a 1e-11 rounding residue into permanent debt.
      movement('dust-out', 4, '-0.00000001', '0'),
      movement('buy-new-log', 5, '0.999', '0.999', 'buy-new')],
    wallets: [{ coin: 'BTC', quantity: '0.999', spot_borrow: '0' }],
    markets: [{ symbol: 'BTCUSDT', base_coin: 'BTC', quote_coin: 'USDT', bid_price: '110', last_price: '111', observed_at: day(6) }],
    coverage: { from: day(1), through: day(6), last_synced_at: day(6), executions_complete: true,
      inventory_complete: { BTC: true }, execution_count: 3, windows_checked: 1, windows_total: 1, syncing: false, error: null },
    now: day(6),
  };
}

describe('Venue-rounded flat boundary followed by a real new investment', () => {
  it('does not let a subprecision transfer residue destroy the next purchase cost', () => {
    const result = buildSpotPerformance(input());
    expect(result.holdings).toHaveLength(1);
    const holding = result.holdings[0];
    expect(holding.asset).toBe('BTC');
    expect(holding.reconciled).toBe(true);
    expect(holding.basis_status).toBe('known');
    expect(holding.quantity).toBe('0.999');
    expect(holding.first_buy_at).toBe(day(5));
    expect(holding.cost_basis).toBe('100');
    expect(holding.unrealized_pnl).toBe('9.89');
    expect(result.orders).toHaveLength(3); // No invented balancing trade.
    expect(result.orders.find(o => o.order_id === 'sell-old')?.matches[0]?.buy_order_id).toBe('buy-old');
  });
});
