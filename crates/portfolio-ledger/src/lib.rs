use protocol::RuntimeLedgerSnapshot;

#[derive(Debug, Clone)]
pub struct PortfolioLedger {
    snapshot: RuntimeLedgerSnapshot,
}

impl PortfolioLedger {
    #[must_use]
    pub fn new(snapshot: RuntimeLedgerSnapshot) -> Self {
        Self { snapshot }
    }

    #[must_use]
    pub fn available_usd(&self) -> &str {
        &self.snapshot.totals.available_usd
    }

    #[must_use]
    pub fn reserved_usd(&self) -> &str {
        &self.snapshot.totals.reserved_usd
    }

    #[must_use]
    pub fn balance_count(&self) -> usize {
        self.snapshot.balances.len()
    }
}

#[cfg(test)]
mod tests {
    use protocol::RuntimeLedgerTotals;

    use super::*;

    #[test]
    fn exposes_snapshot_totals() {
        let ledger = PortfolioLedger::new(RuntimeLedgerSnapshot {
            schema_version: "v1".to_string(),
            snapshot_id: "ledger_1".to_string(),
            deployment_id: "dep_1".to_string(),
            sleeve_id: "sleeve_1".to_string(),
            as_of: "2026-03-07T19:05:00Z".to_string(),
            balances: vec![],
            positions: vec![],
            totals: RuntimeLedgerTotals {
                equity_usd: "100".to_string(),
                reserved_usd: "5".to_string(),
                available_usd: "95".to_string(),
                realized_pnl_usd: "0".to_string(),
                unrealized_pnl_usd: "0".to_string(),
            },
        });

        assert_eq!(ledger.available_usd(), "95");
        assert_eq!(ledger.reserved_usd(), "5");
        assert_eq!(ledger.balance_count(), 0);
    }
}
