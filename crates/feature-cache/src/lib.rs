use std::collections::{BTreeMap, VecDeque};

use market_adapters::{FeedReplayFixture, MarketFeedEvent, SlotCommitment, SlotFeedEvent};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureCacheConfig {
    pub feature_stale_after_ms: u64,
    pub slot_stale_after_ms: u64,
    pub max_slot_gap: u64,
    pub short_window_ms: u64,
    pub long_window_ms: u64,
    pub volatility_window_size: usize,
    pub max_samples_per_stream: usize,
}

impl FeatureCacheConfig {
    #[must_use]
    pub fn new(
        feature_stale_after_ms: u64,
        slot_stale_after_ms: u64,
        max_slot_gap: u64,
        short_window_ms: u64,
        long_window_ms: u64,
        volatility_window_size: usize,
        max_samples_per_stream: usize,
    ) -> Self {
        Self {
            feature_stale_after_ms,
            slot_stale_after_ms,
            max_slot_gap,
            short_window_ms,
            long_window_ms,
            volatility_window_size,
            max_samples_per_stream,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFreshnessContracts {
    pub feature_stale_after_ms: u64,
    pub slot_stale_after_ms: u64,
    pub max_slot_gap: u64,
    pub short_window_ms: u64,
    pub long_window_ms: u64,
    pub volatility_window_size: usize,
    pub max_samples_per_stream: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedMarketFeatureSnapshot {
    pub cache_key: String,
    pub symbol: String,
    pub source: String,
    pub last_sequence: u64,
    pub observed_at: String,
    pub age_ms: u64,
    pub stale: bool,
    pub stale_reasons: Vec<String>,
    pub sample_count: usize,
    pub window_short_ms: u64,
    pub window_long_ms: u64,
    pub mid_price_usd: String,
    pub bid_price_usd: Option<String>,
    pub ask_price_usd: Option<String>,
    pub spread_bps: Option<String>,
    pub short_return_bps: Option<String>,
    pub long_return_bps: Option<String>,
    pub realized_volatility_bps: Option<String>,
    pub processed_slot: Option<u64>,
    pub slot_age_ms: Option<u64>,
    pub slot_gap: Option<u64>,
    pub last_ingest_lag_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureCacheSnapshot {
    pub status: String,
    pub freshness: FeatureFreshnessContracts,
    pub feature_streams: Vec<DerivedMarketFeatureSnapshot>,
    pub stale_feature_keys: Vec<String>,
    pub max_feature_age_ms: u64,
    pub max_slot_age_ms: u64,
    pub max_slot_gap_observed: u64,
    pub max_ingest_lag_ms: u64,
    pub total_market_samples: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Error)]
pub enum FeatureCacheError {
    #[error("invalid RFC3339 timestamp: {value}")]
    InvalidTimestamp { value: String },
    #[error("invalid numeric value for {field}: {value}")]
    InvalidNumber { field: &'static str, value: String },
}

#[derive(Debug, Clone)]
struct MarketSample {
    source: String,
    symbol: String,
    sequence: u64,
    observed_at: String,
    observed_at_ts: OffsetDateTime,
    received_at_ts: OffsetDateTime,
    price_usd: String,
    price_value: f64,
    bid_price_usd: Option<String>,
    bid_value: Option<f64>,
    ask_price_usd: Option<String>,
    ask_value: Option<f64>,
}

#[derive(Debug, Clone)]
struct SlotState {
    slot: u64,
    sequence: u64,
    observed_at_ts: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct FeatureCache {
    config: FeatureCacheConfig,
    market_streams: BTreeMap<String, VecDeque<MarketSample>>,
    slot_commitments: BTreeMap<SlotCommitment, SlotState>,
    last_error: Option<String>,
}

impl FeatureCache {
    #[must_use]
    pub fn new(config: FeatureCacheConfig) -> Self {
        Self {
            config,
            market_streams: BTreeMap::new(),
            slot_commitments: BTreeMap::new(),
            last_error: None,
        }
    }

    pub fn mark_degraded(&mut self, reason: &str) {
        self.last_error = Some(reason.to_string());
    }

    pub fn apply_replay_fixture(
        &mut self,
        fixture: &FeedReplayFixture,
    ) -> Result<(), FeatureCacheError> {
        for event in fixture.market_events.iter().cloned() {
            self.ingest_market_event(event)?;
        }

        for event in fixture.slot_events.iter().cloned() {
            self.ingest_slot_event(event)?;
        }

        Ok(())
    }

    pub fn ingest_market_event(
        &mut self,
        event: MarketFeedEvent,
    ) -> Result<bool, FeatureCacheError> {
        let observed_at_ts = parse_timestamp(&event.observed_at)?;
        let received_at_ts = parse_timestamp(&event.received_at)?;
        let price_value = parse_number("priceUsd", &event.price_usd)?;
        let bid_value = event
            .bid_price_usd
            .as_deref()
            .map(|value| parse_number("bidPriceUsd", value))
            .transpose()?;
        let ask_value = event
            .ask_price_usd
            .as_deref()
            .map(|value| parse_number("askPriceUsd", value))
            .transpose()?;
        let cache_key = cache_key(&event.source, &event.symbol);
        let samples = self.market_streams.entry(cache_key).or_default();
        let duplicate = samples
            .back()
            .is_some_and(|existing| event.sequence <= existing.sequence);
        if duplicate {
            return Ok(false);
        }

        samples.push_back(MarketSample {
            source: event.source,
            symbol: event.symbol,
            sequence: event.sequence,
            observed_at: event.observed_at,
            observed_at_ts,
            received_at_ts,
            price_usd: event.price_usd,
            price_value,
            bid_price_usd: event.bid_price_usd,
            bid_value,
            ask_price_usd: event.ask_price_usd,
            ask_value,
        });

        while samples.len() > self.config.max_samples_per_stream {
            samples.pop_front();
        }

        self.last_error = None;
        Ok(true)
    }

    pub fn ingest_slot_event(&mut self, event: SlotFeedEvent) -> Result<bool, FeatureCacheError> {
        let observed_at_ts = parse_timestamp(&event.observed_at)?;
        let duplicate = self
            .slot_commitments
            .get(&event.commitment)
            .is_some_and(|existing| {
                event.sequence <= existing.sequence || event.slot < existing.slot
            });
        if duplicate {
            return Ok(false);
        }

        self.slot_commitments.insert(
            event.commitment,
            SlotState {
                slot: event.slot,
                sequence: event.sequence,
                observed_at_ts,
            },
        );
        self.last_error = None;
        Ok(true)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> FeatureCacheSnapshot {
        self.snapshot_at(OffsetDateTime::now_utc())
    }

    #[must_use]
    pub fn snapshot_at(&self, now: OffsetDateTime) -> FeatureCacheSnapshot {
        let processed_slot = self
            .slot_commitments
            .get(&SlotCommitment::Processed)
            .map(|state| state.slot)
            .or_else(|| self.slot_commitments.values().map(|state| state.slot).max());

        let max_slot_age_ms = self
            .slot_commitments
            .values()
            .map(|state| age_ms(now, state.observed_at_ts))
            .max()
            .unwrap_or(0);

        let mut stale_feature_keys = Vec::new();
        let mut max_feature_age_ms = 0_u64;
        let mut max_slot_gap_observed = 0_u64;
        let mut max_ingest_lag_ms = 0_u64;
        let mut total_market_samples = 0_usize;

        let feature_streams: Vec<DerivedMarketFeatureSnapshot> = self
            .market_streams
            .iter()
            .map(|(key, samples)| {
                total_market_samples += samples.len();
                let latest = samples
                    .back()
                    .expect("feature cache stream to be non-empty");
                let feature_age_ms = age_ms(now, latest.observed_at_ts);
                max_feature_age_ms = max_feature_age_ms.max(feature_age_ms);
                let ingest_lag_ms = age_ms(latest.received_at_ts, latest.observed_at_ts);
                max_ingest_lag_ms = max_ingest_lag_ms.max(ingest_lag_ms);

                let processed_slot_state = self.slot_commitments.get(&SlotCommitment::Processed);
                let slot_age_ms =
                    processed_slot_state.map(|state| age_ms(now, state.observed_at_ts));
                let slot_gap = processed_slot
                    .zip(processed_slot_state.map(|state| state.slot))
                    .map(|(processed, current)| processed.saturating_sub(current))
                    .or(Some(0));
                if let Some(gap) = slot_gap {
                    max_slot_gap_observed = max_slot_gap_observed.max(gap);
                }

                let mut stale_reasons = Vec::new();
                if feature_age_ms > self.config.feature_stale_after_ms {
                    stale_reasons.push("feature_age_exceeded".to_string());
                }
                if slot_age_ms.is_none() {
                    stale_reasons.push("slot_commitment_missing".to_string());
                }
                if slot_age_ms.is_some_and(|age| age > self.config.slot_stale_after_ms) {
                    stale_reasons.push("slot_age_exceeded".to_string());
                }
                if slot_gap.is_some_and(|gap| gap > self.config.max_slot_gap) {
                    stale_reasons.push("slot_gap_exceeded".to_string());
                }
                if latest.bid_value.is_none() || latest.ask_value.is_none() {
                    stale_reasons.push("spread_missing".to_string());
                }

                let spread_bps = latest
                    .bid_value
                    .zip(latest.ask_value)
                    .and_then(|(bid, ask)| spread_bps(bid, ask));
                let short_return_bps = trailing_return_bps(
                    samples,
                    latest.observed_at_ts,
                    self.config.short_window_ms,
                );
                let long_return_bps =
                    trailing_return_bps(samples, latest.observed_at_ts, self.config.long_window_ms);
                let realized_volatility_bps =
                    realized_volatility_bps(samples, self.config.volatility_window_size);

                let stale = !stale_reasons.is_empty();
                if stale {
                    stale_feature_keys.push(key.clone());
                }

                DerivedMarketFeatureSnapshot {
                    cache_key: key.clone(),
                    symbol: latest.symbol.clone(),
                    source: latest.source.clone(),
                    last_sequence: latest.sequence,
                    observed_at: latest.observed_at.clone(),
                    age_ms: feature_age_ms,
                    stale,
                    stale_reasons,
                    sample_count: samples.len(),
                    window_short_ms: self.config.short_window_ms,
                    window_long_ms: self.config.long_window_ms,
                    mid_price_usd: latest.price_usd.clone(),
                    bid_price_usd: latest.bid_price_usd.clone(),
                    ask_price_usd: latest.ask_price_usd.clone(),
                    spread_bps: spread_bps.map(format_metric),
                    short_return_bps: short_return_bps.map(format_metric),
                    long_return_bps: long_return_bps.map(format_metric),
                    realized_volatility_bps: realized_volatility_bps.map(format_metric),
                    processed_slot,
                    slot_age_ms,
                    slot_gap,
                    last_ingest_lag_ms: ingest_lag_ms,
                }
            })
            .collect();

        let status = if feature_streams.is_empty() || !stale_feature_keys.is_empty() {
            "degraded"
        } else {
            "healthy"
        };
        let status = if self.last_error.is_some() {
            "degraded"
        } else {
            status
        };

        FeatureCacheSnapshot {
            status: status.to_string(),
            freshness: FeatureFreshnessContracts {
                feature_stale_after_ms: self.config.feature_stale_after_ms,
                slot_stale_after_ms: self.config.slot_stale_after_ms,
                max_slot_gap: self.config.max_slot_gap,
                short_window_ms: self.config.short_window_ms,
                long_window_ms: self.config.long_window_ms,
                volatility_window_size: self.config.volatility_window_size,
                max_samples_per_stream: self.config.max_samples_per_stream,
            },
            feature_streams,
            stale_feature_keys,
            max_feature_age_ms,
            max_slot_age_ms,
            max_slot_gap_observed,
            max_ingest_lag_ms,
            total_market_samples,
            last_error: self.last_error.clone(),
        }
    }
}

fn cache_key(source: &str, symbol: &str) -> String {
    format!("{source}:{symbol}")
}

fn parse_timestamp(value: &str) -> Result<OffsetDateTime, FeatureCacheError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| FeatureCacheError::InvalidTimestamp {
        value: value.to_string(),
    })
}

fn parse_number(field: &'static str, value: &str) -> Result<f64, FeatureCacheError> {
    value
        .parse::<f64>()
        .map_err(|_| FeatureCacheError::InvalidNumber {
            field,
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

fn spread_bps(bid: f64, ask: f64) -> Option<f64> {
    let mid = (bid + ask) / 2.0;
    if mid <= 0.0 || ask < bid {
        None
    } else {
        Some(((ask - bid) / mid) * 10_000.0)
    }
}

fn trailing_return_bps(
    samples: &VecDeque<MarketSample>,
    latest_ts: OffsetDateTime,
    window_ms: u64,
) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }
    let threshold = latest_ts - Duration::milliseconds(window_ms as i64);
    let anchor = samples
        .iter()
        .find(|sample| sample.observed_at_ts >= threshold)
        .or_else(|| samples.front())?;
    let latest = samples.back()?;
    if anchor.price_value <= 0.0 {
        None
    } else {
        Some(((latest.price_value / anchor.price_value) - 1.0) * 10_000.0)
    }
}

fn realized_volatility_bps(samples: &VecDeque<MarketSample>, window_size: usize) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }

    let returns: Vec<f64> = samples
        .iter()
        .zip(samples.iter().skip(1))
        .filter_map(|(previous, current)| {
            if previous.price_value <= 0.0 {
                None
            } else {
                Some((current.price_value / previous.price_value) - 1.0)
            }
        })
        .collect();
    if returns.is_empty() {
        return None;
    }

    let start_index = returns.len().saturating_sub(window_size);
    let window = &returns[start_index..];
    let mean = window.iter().sum::<f64>() / window.len() as f64;
    let variance = window
        .iter()
        .map(|value| {
            let delta = *value - mean;
            delta * delta
        })
        .sum::<f64>()
        / window.len() as f64;
    Some(variance.sqrt() * 10_000.0)
}

fn format_metric(value: f64) -> String {
    format!("{value:.4}")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use time::OffsetDateTime;

    use super::*;

    fn fixture_path() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(
                "../../services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json",
            )
            .display()
            .to_string()
    }

    fn cache_config() -> FeatureCacheConfig {
        FeatureCacheConfig::new(20_000, 15_000, 2, 10_000, 25_000, 4, 8)
    }

    #[test]
    fn derives_features_deterministically_from_replay() {
        let fixture = FeedReplayFixture::load_from_path(fixture_path()).expect("fixture to load");
        let mut cache = FeatureCache::new(cache_config());
        cache
            .apply_replay_fixture(&fixture)
            .expect("fixture replay to succeed");

        let snapshot = cache.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:00:27Z", &Rfc3339).expect("snapshot time"),
        );

        assert_eq!(snapshot.status, "healthy");
        assert_eq!(snapshot.total_market_samples, 6);
        assert_eq!(snapshot.max_ingest_lag_ms, 1000);
        let stream = snapshot
            .feature_streams
            .first()
            .expect("feature stream to exist");
        assert_eq!(stream.cache_key, "fixture.jupiter:SOL/USDC");
        assert_eq!(stream.sample_count, 6);
        assert_eq!(stream.mid_price_usd, "142.4400");
        assert_eq!(stream.spread_bps.as_deref(), Some("7.0205"));
        assert_eq!(stream.short_return_bps.as_deref(), Some("9.8384"));
        assert_eq!(stream.long_return_bps.as_deref(), Some("30.9859"));
        assert_eq!(stream.realized_volatility_bps.as_deref(), Some("14.8619"));
        assert_eq!(stream.last_ingest_lag_ms, 1000);
        assert!(stream.stale_reasons.is_empty());
    }

    #[test]
    fn enforces_feature_and_slot_freshness_windows() {
        let fixture = FeedReplayFixture::load_from_path(fixture_path()).expect("fixture to load");
        let mut cache = FeatureCache::new(cache_config());
        cache
            .apply_replay_fixture(&fixture)
            .expect("fixture replay to succeed");

        let snapshot = cache.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:01:05Z", &Rfc3339).expect("snapshot time"),
        );

        assert_eq!(snapshot.status, "degraded");
        assert_eq!(
            snapshot.stale_feature_keys,
            vec!["fixture.jupiter:SOL/USDC".to_string()]
        );
        let stream = snapshot
            .feature_streams
            .first()
            .expect("feature stream to exist");
        assert!(stream.stale);
        assert!(stream
            .stale_reasons
            .contains(&"feature_age_exceeded".to_string()));
        assert!(stream
            .stale_reasons
            .contains(&"slot_age_exceeded".to_string()));
    }

    #[test]
    fn ignores_duplicate_sequences_and_trims_old_samples() {
        let fixture = FeedReplayFixture::load_from_path(fixture_path()).expect("fixture to load");
        let mut cache = FeatureCache::new(FeatureCacheConfig::new(
            20_000, 15_000, 2, 10_000, 25_000, 4, 3,
        ));
        cache
            .apply_replay_fixture(&fixture)
            .expect("fixture replay to succeed");

        let duplicate = cache
            .ingest_market_event(fixture.market_events[0].clone())
            .expect("duplicate event to parse");
        assert!(!duplicate);

        let snapshot = cache.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:00:27Z", &Rfc3339).expect("snapshot time"),
        );
        let stream = snapshot
            .feature_streams
            .first()
            .expect("feature stream to exist");
        assert_eq!(stream.sample_count, 3);
        assert_eq!(snapshot.total_market_samples, 3);
    }
}
