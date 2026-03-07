use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const DEFAULT_MARKET_SYMBOL: &str = "SOL/USDC";
const DEFAULT_BASE_MINT: &str = "So11111111111111111111111111111111111111112";
const DEFAULT_QUOTE_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_MARKET_PRICE_USD: &str = "142.00";
const DEFAULT_SLOT_HEAD: u64 = 310_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterStatus {
    Healthy,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Bootstrapping,
    Connected,
    Reconnecting,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketAdapterHealth {
    pub provider: String,
    pub websocket_url: String,
    pub rpc_url: String,
    pub status: AdapterStatus,
    pub connection_state: ConnectionState,
    pub last_connected_at: Option<String>,
    pub last_message_at: Option<String>,
    pub reconnect_count: u64,
    pub last_error: Option<String>,
}

impl MarketAdapterHealth {
    #[must_use]
    pub fn bootstrap(provider: &str, websocket_url: &str, rpc_url: &str) -> Self {
        Self {
            provider: provider.to_string(),
            websocket_url: websocket_url.to_string(),
            rpc_url: rpc_url.to_string(),
            status: AdapterStatus::Healthy,
            connection_state: ConnectionState::Bootstrapping,
            last_connected_at: None,
            last_message_at: None,
            reconnect_count: 0,
            last_error: None,
        }
    }

    pub fn mark_message(&mut self, observed_at: &str) {
        self.last_message_at = Some(observed_at.to_string());
        if self.last_connected_at.is_none() {
            self.last_connected_at = Some(observed_at.to_string());
        }
        self.status = AdapterStatus::Healthy;
        self.connection_state = ConnectionState::Connected;
        self.last_error = None;
    }

    pub fn mark_reconnecting(&mut self, observed_at: &str, reason: &str) {
        self.last_message_at = Some(observed_at.to_string());
        self.reconnect_count = self.reconnect_count.saturating_add(1);
        self.status = AdapterStatus::Degraded;
        self.connection_state = ConnectionState::Reconnecting;
        self.last_error = Some(reason.to_string());
    }

    pub fn mark_degraded(&mut self, reason: &str) {
        self.status = AdapterStatus::Degraded;
        self.connection_state = ConnectionState::Degraded;
        self.last_error = Some(reason.to_string());
    }

    #[must_use]
    pub fn status_label(&self) -> &'static str {
        match self.status {
            AdapterStatus::Healthy => "healthy",
            AdapterStatus::Degraded => "degraded",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedGatewayConfig {
    pub provider: String,
    pub websocket_url: String,
    pub rpc_url: String,
    pub market_stale_after_ms: u64,
    pub slot_stale_after_ms: u64,
    pub max_slot_gap: u64,
}

impl FeedGatewayConfig {
    #[must_use]
    pub fn new(
        provider: &str,
        websocket_url: &str,
        rpc_url: &str,
        market_stale_after_ms: u64,
        slot_stale_after_ms: u64,
        max_slot_gap: u64,
    ) -> Self {
        Self {
            provider: provider.to_string(),
            websocket_url: websocket_url.to_string(),
            rpc_url: rpc_url.to_string(),
            market_stale_after_ms,
            slot_stale_after_ms,
            max_slot_gap,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotCommitment {
    Processed,
    Confirmed,
    Finalized,
}

impl SlotCommitment {
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Processed => "processed",
            Self::Confirmed => "confirmed",
            Self::Finalized => "finalized",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketFeedEvent {
    pub source: String,
    pub symbol: String,
    pub base_mint: String,
    pub quote_mint: String,
    pub price_usd: String,
    pub observed_at: String,
    pub received_at: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotFeedEvent {
    pub source: String,
    pub commitment: SlotCommitment,
    pub slot: u64,
    pub observed_at: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReplayFixture {
    pub schema_version: String,
    pub market_events: Vec<MarketFeedEvent>,
    pub slot_events: Vec<SlotFeedEvent>,
}

impl FeedReplayFixture {
    pub fn from_json_str(input: &str) -> Result<Self, FeedGatewayError> {
        serde_json::from_str(input).map_err(FeedGatewayError::InvalidFixtureJson)
    }

    pub fn load_from_path(path: impl AsRef<Path>) -> Result<Self, FeedGatewayError> {
        let raw =
            fs::read_to_string(path.as_ref()).map_err(|source| FeedGatewayError::FixtureIo {
                path: path.as_ref().display().to_string(),
                source,
            })?;
        Self::from_json_str(&raw)
    }

    pub fn bootstrap(now: OffsetDateTime) -> Result<Self, FeedGatewayError> {
        Self::bootstrap_with_sequence_seed(now, 0)
    }

    pub fn bootstrap_with_sequence_seed(
        now: OffsetDateTime,
        sequence_seed: u64,
    ) -> Result<Self, FeedGatewayError> {
        let observed_at = format_timestamp(now)?;
        let received_at = format_timestamp(now)?;
        Ok(Self {
            schema_version: "v1".to_string(),
            market_events: vec![MarketFeedEvent {
                source: "fixture.jupiter".to_string(),
                symbol: DEFAULT_MARKET_SYMBOL.to_string(),
                base_mint: DEFAULT_BASE_MINT.to_string(),
                quote_mint: DEFAULT_QUOTE_MINT.to_string(),
                price_usd: DEFAULT_MARKET_PRICE_USD.to_string(),
                observed_at: observed_at.clone(),
                received_at,
                sequence: sequence_seed + 1,
            }],
            slot_events: vec![
                SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: SlotCommitment::Processed,
                    slot: DEFAULT_SLOT_HEAD,
                    observed_at: observed_at.clone(),
                    sequence: sequence_seed + 11,
                },
                SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: SlotCommitment::Confirmed,
                    slot: DEFAULT_SLOT_HEAD - 1,
                    observed_at: observed_at.clone(),
                    sequence: sequence_seed + 12,
                },
                SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: SlotCommitment::Finalized,
                    slot: DEFAULT_SLOT_HEAD - 2,
                    observed_at,
                    sequence: sequence_seed + 13,
                },
            ],
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedGatewayIngestReport {
    pub market_events_accepted: u64,
    pub market_events_duplicate: u64,
    pub slot_events_accepted: u64,
    pub slot_events_duplicate: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedFreshnessContracts {
    pub market_stale_after_ms: u64,
    pub slot_stale_after_ms: u64,
    pub max_slot_gap: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketFeedStreamSnapshot {
    pub stream_id: String,
    pub symbol: String,
    pub source: String,
    pub last_sequence: u64,
    pub last_price_usd: String,
    pub observed_at: String,
    pub age_ms: u64,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotFeedCommitmentSnapshot {
    pub commitment: String,
    pub source: String,
    pub slot: u64,
    pub observed_at: String,
    pub age_ms: u64,
    pub gap_from_processed: u64,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedGatewaySnapshot {
    pub status: String,
    pub adapter: MarketAdapterHealth,
    pub freshness: FeedFreshnessContracts,
    pub market_streams: Vec<MarketFeedStreamSnapshot>,
    pub slot_commitments: Vec<SlotFeedCommitmentSnapshot>,
    pub market_events_accepted: u64,
    pub market_events_duplicate: u64,
    pub slot_events_accepted: u64,
    pub slot_events_duplicate: u64,
    pub stale_market_streams: Vec<String>,
    pub stale_slot_commitments: Vec<String>,
    pub max_market_age_ms: u64,
    pub max_slot_age_ms: u64,
    pub max_slot_gap_observed: u64,
}

#[derive(Debug, Error)]
pub enum FeedGatewayError {
    #[error("invalid RFC3339 timestamp: {value}")]
    InvalidTimestamp { value: String },
    #[error("could not read feed replay fixture at {path}: {source}")]
    FixtureIo {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid feed replay fixture JSON: {0}")]
    InvalidFixtureJson(#[source] serde_json::Error),
}

#[derive(Debug, Clone)]
struct MarketFeedState {
    source: String,
    symbol: String,
    last_sequence: u64,
    last_price_usd: String,
    observed_at: String,
    observed_at_ts: OffsetDateTime,
}

#[derive(Debug, Clone)]
struct SlotFeedState {
    source: String,
    slot: u64,
    last_sequence: u64,
    observed_at: String,
    observed_at_ts: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct FeedGateway {
    config: FeedGatewayConfig,
    adapter: MarketAdapterHealth,
    market_streams: BTreeMap<String, MarketFeedState>,
    slot_commitments: BTreeMap<SlotCommitment, SlotFeedState>,
    ingest_report: FeedGatewayIngestReport,
}

impl FeedGateway {
    #[must_use]
    pub fn new(config: FeedGatewayConfig) -> Self {
        let adapter = MarketAdapterHealth::bootstrap(
            &config.provider,
            &config.websocket_url,
            &config.rpc_url,
        );
        Self {
            config,
            adapter,
            market_streams: BTreeMap::new(),
            slot_commitments: BTreeMap::new(),
            ingest_report: FeedGatewayIngestReport::default(),
        }
    }

    #[must_use]
    pub fn adapter_health(&self) -> &MarketAdapterHealth {
        &self.adapter
    }

    pub fn mark_reconnecting(&mut self, observed_at: &str, reason: &str) {
        self.adapter.mark_reconnecting(observed_at, reason);
    }

    pub fn mark_degraded(&mut self, reason: &str) {
        self.adapter.mark_degraded(reason);
    }

    pub fn apply_replay_fixture(
        &mut self,
        fixture: &FeedReplayFixture,
    ) -> Result<FeedGatewayIngestReport, FeedGatewayError> {
        let mut report = FeedGatewayIngestReport::default();

        for event in fixture.market_events.iter().cloned() {
            if self.ingest_market_event(event)? {
                report.market_events_accepted = report.market_events_accepted.saturating_add(1);
            } else {
                report.market_events_duplicate = report.market_events_duplicate.saturating_add(1);
            }
        }

        for event in fixture.slot_events.iter().cloned() {
            if self.ingest_slot_event(event)? {
                report.slot_events_accepted = report.slot_events_accepted.saturating_add(1);
            } else {
                report.slot_events_duplicate = report.slot_events_duplicate.saturating_add(1);
            }
        }

        Ok(report)
    }

    pub fn ingest_market_event(
        &mut self,
        event: MarketFeedEvent,
    ) -> Result<bool, FeedGatewayError> {
        let observed_at_ts = parse_timestamp(&event.observed_at)?;
        let received_at_ts = parse_timestamp(&event.received_at)?;
        let stream_id = market_stream_id(&event.source, &event.symbol);

        self.adapter.mark_message(&event.received_at);
        let duplicate = self
            .market_streams
            .get(&stream_id)
            .is_some_and(|existing| event.sequence <= existing.last_sequence);
        if duplicate {
            self.ingest_report.market_events_duplicate =
                self.ingest_report.market_events_duplicate.saturating_add(1);
            if received_at_ts >= observed_at_ts {
                self.adapter.mark_message(&event.received_at);
            }
            return Ok(false);
        }

        self.market_streams.insert(
            stream_id,
            MarketFeedState {
                source: event.source,
                symbol: event.symbol,
                last_sequence: event.sequence,
                last_price_usd: event.price_usd,
                observed_at: event.observed_at,
                observed_at_ts,
            },
        );
        self.ingest_report.market_events_accepted =
            self.ingest_report.market_events_accepted.saturating_add(1);
        Ok(true)
    }

    pub fn ingest_slot_event(&mut self, event: SlotFeedEvent) -> Result<bool, FeedGatewayError> {
        let observed_at_ts = parse_timestamp(&event.observed_at)?;
        self.adapter.mark_message(&event.observed_at);
        let duplicate = self
            .slot_commitments
            .get(&event.commitment)
            .is_some_and(|existing| {
                event.sequence <= existing.last_sequence || event.slot < existing.slot
            });
        if duplicate {
            self.ingest_report.slot_events_duplicate =
                self.ingest_report.slot_events_duplicate.saturating_add(1);
            return Ok(false);
        }

        self.slot_commitments.insert(
            event.commitment,
            SlotFeedState {
                source: event.source,
                slot: event.slot,
                last_sequence: event.sequence,
                observed_at: event.observed_at,
                observed_at_ts,
            },
        );
        self.ingest_report.slot_events_accepted =
            self.ingest_report.slot_events_accepted.saturating_add(1);
        Ok(true)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> FeedGatewaySnapshot {
        self.snapshot_at(OffsetDateTime::now_utc())
    }

    #[must_use]
    pub fn snapshot_at(&self, now: OffsetDateTime) -> FeedGatewaySnapshot {
        let processed_slot = self
            .slot_commitments
            .get(&SlotCommitment::Processed)
            .map(|state| state.slot)
            .or_else(|| self.slot_commitments.values().map(|state| state.slot).max())
            .unwrap_or(0);

        let mut stale_market_streams = Vec::new();
        let mut max_market_age_ms = 0_u64;
        let market_streams: Vec<MarketFeedStreamSnapshot> = self
            .market_streams
            .iter()
            .map(|(stream_id, state)| {
                let age_ms = age_ms(now, state.observed_at_ts);
                let stale = age_ms > self.config.market_stale_after_ms;
                if stale {
                    stale_market_streams.push(stream_id.clone());
                }
                max_market_age_ms = max_market_age_ms.max(age_ms);
                MarketFeedStreamSnapshot {
                    stream_id: stream_id.clone(),
                    symbol: state.symbol.clone(),
                    source: state.source.clone(),
                    last_sequence: state.last_sequence,
                    last_price_usd: state.last_price_usd.clone(),
                    observed_at: state.observed_at.clone(),
                    age_ms,
                    stale,
                }
            })
            .collect();

        let mut stale_slot_commitments = Vec::new();
        let mut max_slot_age_ms = 0_u64;
        let mut max_slot_gap_observed = 0_u64;
        let slot_commitments: Vec<SlotFeedCommitmentSnapshot> = self
            .slot_commitments
            .iter()
            .map(|(commitment, state)| {
                let age_ms = age_ms(now, state.observed_at_ts);
                let gap_from_processed = processed_slot.saturating_sub(state.slot);
                let stale = age_ms > self.config.slot_stale_after_ms
                    || gap_from_processed > self.config.max_slot_gap;
                if stale {
                    stale_slot_commitments.push(commitment.as_str().to_string());
                }
                max_slot_age_ms = max_slot_age_ms.max(age_ms);
                max_slot_gap_observed = max_slot_gap_observed.max(gap_from_processed);
                SlotFeedCommitmentSnapshot {
                    commitment: commitment.as_str().to_string(),
                    source: state.source.clone(),
                    slot: state.slot,
                    observed_at: state.observed_at.clone(),
                    age_ms,
                    gap_from_processed,
                    stale,
                }
            })
            .collect();

        let status = if self.adapter.status == AdapterStatus::Degraded
            || market_streams.is_empty()
            || slot_commitments.is_empty()
            || !stale_market_streams.is_empty()
            || !stale_slot_commitments.is_empty()
        {
            "degraded"
        } else {
            "healthy"
        };

        FeedGatewaySnapshot {
            status: status.to_string(),
            adapter: self.adapter.clone(),
            freshness: FeedFreshnessContracts {
                market_stale_after_ms: self.config.market_stale_after_ms,
                slot_stale_after_ms: self.config.slot_stale_after_ms,
                max_slot_gap: self.config.max_slot_gap,
            },
            market_streams,
            slot_commitments,
            market_events_accepted: self.ingest_report.market_events_accepted,
            market_events_duplicate: self.ingest_report.market_events_duplicate,
            slot_events_accepted: self.ingest_report.slot_events_accepted,
            slot_events_duplicate: self.ingest_report.slot_events_duplicate,
            stale_market_streams,
            stale_slot_commitments,
            max_market_age_ms,
            max_slot_age_ms,
            max_slot_gap_observed,
        }
    }
}

fn market_stream_id(source: &str, symbol: &str) -> String {
    format!("{source}:{symbol}")
}

fn parse_timestamp(value: &str) -> Result<OffsetDateTime, FeedGatewayError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| FeedGatewayError::InvalidTimestamp {
        value: value.to_string(),
    })
}

fn format_timestamp(value: OffsetDateTime) -> Result<String, FeedGatewayError> {
    value
        .format(&Rfc3339)
        .map_err(|_| FeedGatewayError::InvalidTimestamp {
            value: value.to_string(),
        })
}

fn age_ms(now: OffsetDateTime, observed_at: OffsetDateTime) -> u64 {
    let delta = (now - observed_at).whole_milliseconds();
    if delta <= 0 {
        0
    } else {
        delta as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json")
            .display()
            .to_string()
    }

    fn gateway_config() -> FeedGatewayConfig {
        FeedGatewayConfig::new(
            "fixture",
            "wss://fixture.invalid/runtime",
            "https://fixture.invalid/runtime",
            30_000,
            15_000,
            2,
        )
    }

    #[test]
    fn bootstraps_healthy_adapter_state() {
        let health = MarketAdapterHealth::bootstrap(
            "jupiter",
            "wss://price-feed.example",
            "https://rpc.example",
        );

        assert_eq!(health.provider, "jupiter");
        assert_eq!(health.status_label(), "healthy");
        assert_eq!(health.connection_state, ConnectionState::Bootstrapping);
    }

    #[test]
    fn applies_replay_fixture_and_tracks_duplicates() {
        let mut gateway = FeedGateway::new(gateway_config());
        let fixture = FeedReplayFixture::load_from_path(fixture_path()).expect("fixture to load");

        let first_report = gateway
            .apply_replay_fixture(&fixture)
            .expect("fixture replay to succeed");
        let duplicate_report = gateway
            .apply_replay_fixture(&fixture)
            .expect("duplicate replay to succeed");

        assert_eq!(first_report.market_events_accepted, 2);
        assert_eq!(first_report.slot_events_accepted, 3);
        assert_eq!(duplicate_report.market_events_duplicate, 2);
        assert_eq!(duplicate_report.slot_events_duplicate, 3);
        assert_eq!(
            gateway.adapter_health().connection_state,
            ConnectionState::Connected,
        );
    }

    #[test]
    fn computes_freshness_and_slot_gap_contracts() {
        let mut gateway = FeedGateway::new(gateway_config());
        let fixture = FeedReplayFixture::load_from_path(fixture_path()).expect("fixture to load");
        gateway
            .apply_replay_fixture(&fixture)
            .expect("fixture replay to succeed");

        let healthy_snapshot = gateway.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:00:18Z", &Rfc3339).expect("snapshot time"),
        );
        assert_eq!(healthy_snapshot.status, "healthy");
        assert_eq!(healthy_snapshot.max_slot_gap_observed, 2);
        assert!(healthy_snapshot.stale_market_streams.is_empty());
        assert!(healthy_snapshot.stale_slot_commitments.is_empty());

        let stale_snapshot = gateway.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:01:10Z", &Rfc3339).expect("stale time"),
        );
        assert_eq!(stale_snapshot.status, "degraded");
        assert_eq!(
            stale_snapshot.stale_market_streams,
            vec!["fixture.jupiter:SOL/USDC"]
        );
        assert_eq!(
            stale_snapshot.stale_slot_commitments,
            vec!["processed", "confirmed", "finalized"],
        );
    }

    #[test]
    fn surfaces_reconnect_transitions() {
        let mut gateway = FeedGateway::new(gateway_config());
        gateway.mark_reconnecting("2026-03-07T00:00:10Z", "socket-reset");
        assert_eq!(gateway.adapter_health().status_label(), "degraded");
        assert_eq!(
            gateway.adapter_health().connection_state,
            ConnectionState::Reconnecting,
        );

        gateway
            .ingest_slot_event(SlotFeedEvent {
                source: "fixture.helius".to_string(),
                commitment: SlotCommitment::Processed,
                slot: DEFAULT_SLOT_HEAD,
                observed_at: "2026-03-07T00:00:11Z".to_string(),
                sequence: 10,
            })
            .expect("slot event to ingest");
        assert_eq!(gateway.adapter_health().status_label(), "healthy");
        assert_eq!(
            gateway.adapter_health().connection_state,
            ConnectionState::Connected,
        );
        assert_eq!(gateway.adapter_health().reconnect_count, 1);
    }

    #[test]
    fn builds_bootstrap_fixture() {
        let fixture = FeedReplayFixture::bootstrap(
            OffsetDateTime::parse("2026-03-07T00:00:00Z", &Rfc3339).expect("bootstrap time"),
        )
        .expect("bootstrap fixture");
        assert_eq!(fixture.market_events.len(), 1);
        assert_eq!(fixture.slot_events.len(), 3);
    }
}
