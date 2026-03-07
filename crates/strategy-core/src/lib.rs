#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategyKind {
    Dca,
    ThresholdRebalance,
    Twap,
    TrendFollowing,
    MeanReversion,
}

impl StrategyKind {
    #[must_use]
    pub fn as_key(&self) -> &'static str {
        match self {
            Self::Dca => "dca",
            Self::ThresholdRebalance => "threshold_rebalance",
            Self::Twap => "twap",
            Self::TrendFollowing => "trend_following",
            Self::MeanReversion => "mean_reversion",
        }
    }
}

pub const SUPPORTED_STRATEGIES: [StrategyKind; 5] = [
    StrategyKind::Dca,
    StrategyKind::ThresholdRebalance,
    StrategyKind::Twap,
    StrategyKind::TrendFollowing,
    StrategyKind::MeanReversion,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyDeploymentDescriptor {
    pub deployment_id: String,
    pub sleeve_id: String,
    pub strategy: StrategyKind,
}

impl StrategyDeploymentDescriptor {
    #[must_use]
    pub fn strategy_key(&self) -> &'static str {
        self.strategy.as_key()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_supported_strategy_keys() {
        let keys: Vec<&str> = SUPPORTED_STRATEGIES
            .iter()
            .map(StrategyKind::as_key)
            .collect();

        assert_eq!(
            keys,
            vec![
                "dca",
                "threshold_rebalance",
                "twap",
                "trend_following",
                "mean_reversion",
            ],
        );
    }
}
