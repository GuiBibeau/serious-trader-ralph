#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdapterStatus {
    Healthy,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarketAdapterHealth {
    pub provider: String,
    pub websocket_url: String,
    pub rpc_url: String,
    pub status: AdapterStatus,
}

impl MarketAdapterHealth {
    #[must_use]
    pub fn bootstrap(provider: &str, websocket_url: &str, rpc_url: &str) -> Self {
        Self {
            provider: provider.to_string(),
            websocket_url: websocket_url.to_string(),
            rpc_url: rpc_url.to_string(),
            status: AdapterStatus::Healthy,
        }
    }

    #[must_use]
    pub fn status_label(&self) -> &'static str {
        match self.status {
            AdapterStatus::Healthy => "healthy",
            AdapterStatus::Degraded => "degraded",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstraps_healthy_adapter_state() {
        let health = MarketAdapterHealth::bootstrap(
            "jupiter",
            "wss://price-feed.example",
            "https://rpc.example",
        );

        assert_eq!(health.provider, "jupiter");
        assert_eq!(health.status_label(), "healthy");
    }
}
