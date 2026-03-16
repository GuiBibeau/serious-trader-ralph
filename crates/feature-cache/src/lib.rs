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
    pub funding_rate_bps: Option<String>,
    pub basis_bps: Option<String>,
    pub open_interest_usd: Option<String>,
    pub open_interest_delta_bps: Option<String>,
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
    base_mint: String,
    quote_mint: String,
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
    funding_rate_bps: Option<f64>,
    open_interest_usd: Option<f64>,
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
        let funding_rate_bps = event
            .funding_rate_bps
            .as_deref()
            .map(|value| parse_number("fundingRateBps", value))
            .transpose()?;
        let open_interest_usd = event
            .open_interest_usd
            .as_deref()
            .map(|value| parse_number("openInterestUsd", value))
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
            base_mint: event.base_mint,
            quote_mint: event.quote_mint,
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
            funding_rate_bps,
            open_interest_usd,
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
        let slot_head = self.slot_commitments.values().map(|state| state.slot).max();
        let processed_slot = self
            .slot_commitments
            .get(&SlotCommitment::Processed)
            .map(|state| state.slot)
            .or(slot_head);

        let max_slot_age_ms = self
            .slot_commitments
            .values()
            .map(|state| age_ms(now, state.observed_at_ts))
            .max()
            .unwrap_or(0);
        let slot_gap_observed = slot_head.map(|head| {
            self.slot_commitments
                .values()
                .map(|state| head.saturating_sub(state.slot))
                .max()
                .unwrap_or(0)
        });

        let mut stale_feature_keys = Vec::new();
        let mut max_feature_age_ms = 0_u64;
        let mut max_slot_gap_observed = 0_u64;
        let mut max_ingest_lag_ms = 0_u64;
        let mut total_market_samples = 0_usize;
        let latest_spot_by_pair = latest_spot_samples_by_pair(&self.market_streams);

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

                let slot_age_ms = if self.slot_commitments.is_empty() {
                    None
                } else {
                    Some(max_slot_age_ms)
                };
                let slot_gap = slot_gap_observed;
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
                let basis_bps = reference_spot_price_bps(latest, &latest_spot_by_pair);
                let open_interest_delta_bps = trailing_optional_metric_bps(
                    samples,
                    latest.observed_at_ts,
                    self.config.long_window_ms,
                    |sample| sample.open_interest_usd,
                );

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
                    funding_rate_bps: latest.funding_rate_bps.map(format_metric),
                    basis_bps: basis_bps.map(format_metric),
                    open_interest_usd: latest.open_interest_usd.map(format_metric),
                    open_interest_delta_bps: open_interest_delta_bps.map(format_metric),
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

fn trailing_optional_metric_bps(
    samples: &VecDeque<MarketSample>,
    latest_ts: OffsetDateTime,
    window_ms: u64,
    selector: impl Fn(&MarketSample) -> Option<f64>,
) -> Option<f64> {
    if samples.len() < 2 {
        return None;
    }
    let threshold = latest_ts - Duration::milliseconds(window_ms as i64);
    let anchor = samples
        .iter()
        .find(|sample| sample.observed_at_ts >= threshold && selector(sample).is_some())
        .or_else(|| samples.iter().find(|sample| selector(sample).is_some()))?;
    let latest = samples
        .iter()
        .rev()
        .find(|sample| selector(sample).is_some())?;
    let anchor_value = selector(anchor)?;
    let latest_value = selector(latest)?;
    if anchor_value <= 0.0 {
        None
    } else {
        Some(((latest_value / anchor_value) - 1.0) * 10_000.0)
    }
}

fn latest_spot_samples_by_pair<'a>(
    market_streams: &'a BTreeMap<String, VecDeque<MarketSample>>,
) -> BTreeMap<(&'a str, &'a str), &'a MarketSample> {
    let mut latest_by_pair: BTreeMap<(&'a str, &'a str), &'a MarketSample> = BTreeMap::new();
    for samples in market_streams.values() {
        let Some(latest) = samples.back() else {
            continue;
        };
        if is_perp_symbol(&latest.symbol) {
            continue;
        }
        let key = (latest.base_mint.as_str(), latest.quote_mint.as_str());
        match latest_by_pair.get(&key) {
            Some(existing) if !market_sample_is_newer(latest, existing) => {}
            _ => {
                latest_by_pair.insert(key, latest);
            }
        }
    }
    latest_by_pair
}

fn market_sample_is_newer(candidate: &MarketSample, existing: &MarketSample) -> bool {
    (
        candidate.observed_at_ts,
        candidate.received_at_ts,
        candidate.sequence,
        candidate.source.as_str(),
        candidate.symbol.as_str(),
    ) > (
        existing.observed_at_ts,
        existing.received_at_ts,
        existing.sequence,
        existing.source.as_str(),
        existing.symbol.as_str(),
    )
}

fn reference_spot_price_bps(
    latest: &MarketSample,
    latest_spot_by_pair: &BTreeMap<(&str, &str), &MarketSample>,
) -> Option<f64> {
    if !is_perp_symbol(&latest.symbol) {
        return None;
    }
    let reference =
        latest_spot_by_pair.get(&(latest.base_mint.as_str(), latest.quote_mint.as_str()))?;
    if reference.price_value <= 0.0 {
        None
    } else {
        Some(((latest.price_value / reference.price_value) - 1.0) * 10_000.0)
    }
}

fn is_perp_symbol(symbol: &str) -> bool {
    symbol.trim().to_ascii_uppercase().ends_with("-PERP")
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

    use market_adapters::{MarketFeedEvent, SlotFeedEvent};
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

    fn mixed_spot_and_perp_fixture() -> FeedReplayFixture {
        FeedReplayFixture {
            schema_version: "v1".to_string(),
            market_events: vec![
                MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "99.0000".to_string(),
                    bid_price_usd: Some("98.9900".to_string()),
                    ask_price_usd: Some("99.0100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:00Z".to_string(),
                    received_at: "2026-03-07T00:00:00Z".to_string(),
                    sequence: 1,
                },
                MarketFeedEvent {
                    source: "fixture.drift".to_string(),
                    symbol: "SOL-PERP".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "99.4000".to_string(),
                    bid_price_usd: Some("99.3900".to_string()),
                    ask_price_usd: Some("99.4100".to_string()),
                    funding_rate_bps: Some("8.0000".to_string()),
                    open_interest_usd: Some("100000.0000".to_string()),
                    observed_at: "2026-03-07T00:00:00Z".to_string(),
                    received_at: "2026-03-07T00:00:00Z".to_string(),
                    sequence: 2,
                },
                MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "99.5000".to_string(),
                    bid_price_usd: Some("99.4900".to_string()),
                    ask_price_usd: Some("99.5100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:10Z".to_string(),
                    received_at: "2026-03-07T00:00:10Z".to_string(),
                    sequence: 3,
                },
                MarketFeedEvent {
                    source: "fixture.drift".to_string(),
                    symbol: "SOL-PERP".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "99.9000".to_string(),
                    bid_price_usd: Some("99.8900".to_string()),
                    ask_price_usd: Some("99.9100".to_string()),
                    funding_rate_bps: Some("10.0000".to_string()),
                    open_interest_usd: Some("101000.0000".to_string()),
                    observed_at: "2026-03-07T00:00:10Z".to_string(),
                    received_at: "2026-03-07T00:00:10Z".to_string(),
                    sequence: 4,
                },
                MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "100.0000".to_string(),
                    bid_price_usd: Some("99.9900".to_string()),
                    ask_price_usd: Some("100.0100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:20Z".to_string(),
                    received_at: "2026-03-07T00:00:20Z".to_string(),
                    sequence: 5,
                },
                MarketFeedEvent {
                    source: "fixture.drift".to_string(),
                    symbol: "SOL-PERP".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "100.5000".to_string(),
                    bid_price_usd: Some("100.4900".to_string()),
                    ask_price_usd: Some("100.5100".to_string()),
                    funding_rate_bps: Some("12.5000".to_string()),
                    open_interest_usd: Some("103000.0000".to_string()),
                    observed_at: "2026-03-07T00:00:20Z".to_string(),
                    received_at: "2026-03-07T00:00:20Z".to_string(),
                    sequence: 6,
                },
            ],
            slot_events: vec![
                SlotFeedEvent {
                    source: "fixture.slot".to_string(),
                    commitment: SlotCommitment::Processed,
                    slot: 310_000_000,
                    observed_at: "2026-03-07T00:00:00Z".to_string(),
                    sequence: 1,
                },
                SlotFeedEvent {
                    source: "fixture.slot".to_string(),
                    commitment: SlotCommitment::Processed,
                    slot: 310_000_001,
                    observed_at: "2026-03-07T00:00:10Z".to_string(),
                    sequence: 2,
                },
                SlotFeedEvent {
                    source: "fixture.slot".to_string(),
                    commitment: SlotCommitment::Processed,
                    slot: 310_000_002,
                    observed_at: "2026-03-07T00:00:20Z".to_string(),
                    sequence: 3,
                },
            ],
        }
    }

    fn mixed_multi_source_spot_and_perp_fixture() -> FeedReplayFixture {
        FeedReplayFixture {
            schema_version: "v1".to_string(),
            market_events: vec![
                MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "99.0000".to_string(),
                    bid_price_usd: Some("98.9900".to_string()),
                    ask_price_usd: Some("99.0100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:00Z".to_string(),
                    received_at: "2026-03-07T00:00:00Z".to_string(),
                    sequence: 1,
                },
                MarketFeedEvent {
                    source: "fixture.birdeye".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "98.0000".to_string(),
                    bid_price_usd: Some("97.9900".to_string()),
                    ask_price_usd: Some("98.0100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:15Z".to_string(),
                    received_at: "2026-03-07T00:00:15Z".to_string(),
                    sequence: 500,
                },
                MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "100.0000".to_string(),
                    bid_price_usd: Some("99.9900".to_string()),
                    ask_price_usd: Some("100.0100".to_string()),
                    funding_rate_bps: None,
                    open_interest_usd: None,
                    observed_at: "2026-03-07T00:00:20Z".to_string(),
                    received_at: "2026-03-07T00:00:20Z".to_string(),
                    sequence: 5,
                },
                MarketFeedEvent {
                    source: "fixture.drift".to_string(),
                    symbol: "SOL-PERP".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: "100.5000".to_string(),
                    bid_price_usd: Some("100.4900".to_string()),
                    ask_price_usd: Some("100.5100".to_string()),
                    funding_rate_bps: Some("12.5000".to_string()),
                    open_interest_usd: Some("103000.0000".to_string()),
                    observed_at: "2026-03-07T00:00:20Z".to_string(),
                    received_at: "2026-03-07T00:00:20Z".to_string(),
                    sequence: 6,
                },
            ],
            slot_events: vec![SlotFeedEvent {
                source: "fixture.slot".to_string(),
                commitment: SlotCommitment::Processed,
                slot: 310_000_002,
                observed_at: "2026-03-07T00:00:20Z".to_string(),
                sequence: 3,
            }],
        }
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

    #[test]
    fn derives_perp_carry_features_from_mixed_spot_and_perp_streams() {
        let mut cache = FeatureCache::new(cache_config());
        cache
            .apply_replay_fixture(&mixed_spot_and_perp_fixture())
            .expect("fixture replay to succeed");

        let snapshot = cache.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:00:20Z", &Rfc3339).expect("snapshot time"),
        );
        let perp_stream = snapshot
            .feature_streams
            .iter()
            .find(|stream| stream.symbol == "SOL-PERP")
            .expect("perp stream to exist");
        let spot_stream = snapshot
            .feature_streams
            .iter()
            .find(|stream| stream.symbol == "SOL/USDC")
            .expect("spot stream to exist");

        assert_eq!(perp_stream.funding_rate_bps.as_deref(), Some("12.5000"));
        assert_eq!(perp_stream.basis_bps.as_deref(), Some("50.0000"));
        assert_eq!(
            perp_stream.open_interest_usd.as_deref(),
            Some("103000.0000")
        );
        assert_eq!(
            perp_stream.open_interest_delta_bps.as_deref(),
            Some("300.0000")
        );
        assert_eq!(spot_stream.basis_bps, None);
        assert_eq!(snapshot.total_market_samples, 6);
    }

    #[test]
    fn prefers_latest_spot_reference_by_timestamp_across_sources() {
        let mut cache = FeatureCache::new(cache_config());
        cache
            .apply_replay_fixture(&mixed_multi_source_spot_and_perp_fixture())
            .expect("fixture replay to succeed");

        let snapshot = cache.snapshot_at(
            OffsetDateTime::parse("2026-03-07T00:00:20Z", &Rfc3339).expect("snapshot time"),
        );
        let perp_stream = snapshot
            .feature_streams
            .iter()
            .find(|stream| stream.symbol == "SOL-PERP")
            .expect("perp stream to exist");

        assert_eq!(perp_stream.basis_bps.as_deref(), Some("50.0000"));
        assert_eq!(snapshot.total_market_samples, 4);
    }
}
