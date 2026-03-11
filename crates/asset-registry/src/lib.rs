use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeAssetKind, RuntimeAssetListingState, RuntimeAssetRecord, RuntimeAssetRiskClass,
    RuntimeAssetVenueMapping, RuntimeDeploymentRecord, RuntimeMode,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRegistryConfig {
    pub database_url: String,
}

impl AssetRegistryConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AssetRegistry {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRegistrySnapshot {
    pub status: String,
    pub asset_count: u64,
    pub live_asset_count: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AssetRegistryQuery {
    pub asset_key: Option<String>,
    pub venue_key: Option<String>,
    pub listing_state: Option<RuntimeAssetListingState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetWriteResult<T> {
    pub record: T,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupportedPair {
    pub base_asset: RuntimeAssetRecord,
    pub quote_asset: RuntimeAssetRecord,
}

#[derive(Debug, Error)]
pub enum AssetRegistryError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("asset {asset_key} not found")]
    AssetNotFound { asset_key: String },
    #[error("invalid asset record for {asset_key}: {reason}")]
    InvalidRecord { asset_key: String, reason: String },
    #[error("invalid asset transition for {asset_key}: {from_state:?} -> {to_state:?}")]
    InvalidStateTransition {
        asset_key: String,
        from_state: RuntimeAssetListingState,
        to_state: RuntimeAssetListingState,
    },
    #[error("asset {asset_key} does not support mode {mode:?} while in state {listing_state:?}")]
    AssetModeUnsupported {
        asset_key: String,
        listing_state: RuntimeAssetListingState,
        mode: RuntimeMode,
    },
    #[error("asset {asset_key} does not support venue {venue_key}")]
    VenueMappingMissing {
        asset_key: String,
        venue_key: String,
    },
    #[error("asset {base_asset_key} does not support quote asset {quote_asset_key}")]
    QuoteAssetUnsupported {
        base_asset_key: String,
        quote_asset_key: String,
    },
    #[error("asset {asset_key} venue {venue_key} mapping is {listing_state:?} and does not support mode {mode:?}")]
    VenueMappingModeUnsupported {
        asset_key: String,
        venue_key: String,
        listing_state: RuntimeAssetListingState,
        mode: RuntimeMode,
    },
    #[error("asset {base_asset_key} venue {venue_key} mapping does not support quote asset {quote_asset_key}")]
    VenueMappingQuoteUnsupported {
        base_asset_key: String,
        quote_asset_key: String,
        venue_key: String,
    },
    #[error("asset mapping not found for venue {venue_key} native id {native_id}")]
    VenueNativeIdNotFound {
        venue_key: String,
        native_id: String,
    },
}

impl AssetRegistry {
    pub fn new(config: AssetRegistryConfig) -> Result<Self, AssetRegistryError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(registry) => Ok(registry),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn upsert_asset(
        &self,
        record: &RuntimeAssetRecord,
    ) -> Result<AssetWriteResult<RuntimeAssetRecord>, AssetRegistryError> {
        validate_asset_record(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let existing = load_asset(&transaction, &record.asset_key)?;
        persist_asset(&transaction, record)?;
        transaction.commit()?;
        Ok(AssetWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn get_asset(
        &self,
        asset_key: &str,
    ) -> Result<Option<RuntimeAssetRecord>, AssetRegistryError> {
        let connection = self.open_connection()?;
        load_asset(&connection, asset_key)
    }

    pub fn list_assets(
        &self,
        query: &AssetRegistryQuery,
    ) -> Result<Vec<RuntimeAssetRecord>, AssetRegistryError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT DISTINCT a.record_json
             FROM asset_records a
             LEFT JOIN asset_venue_mappings m ON m.asset_key = a.asset_key
             WHERE (?1 IS NULL OR a.asset_key = ?1)
               AND (?2 IS NULL OR a.listing_state = ?2)
               AND (?3 IS NULL OR m.venue_key = ?3)
             ORDER BY a.updated_at DESC, a.asset_key DESC",
        )?;
        let listing_state = query.listing_state.as_ref().map(listing_state_key);
        let rows = statement.query_map(
            params![
                query.asset_key.as_deref(),
                listing_state,
                query.venue_key.as_deref(),
            ],
            |row| row.get::<_, String>(0),
        )?;
        let mut assets = Vec::new();
        for row in rows {
            assets.push(deserialize_json(&row?)?);
        }
        Ok(assets)
    }

    pub fn transition_asset(
        &self,
        asset_key: &str,
        next_state: RuntimeAssetListingState,
        changed_at: &str,
    ) -> Result<RuntimeAssetRecord, AssetRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut record = load_asset(&transaction, asset_key)?.ok_or_else(|| {
            AssetRegistryError::AssetNotFound {
                asset_key: asset_key.to_string(),
            }
        })?;
        if record.listing_state != next_state
            && !can_transition_listing_state(&record.listing_state, &next_state)
        {
            return Err(AssetRegistryError::InvalidStateTransition {
                asset_key: asset_key.to_string(),
                from_state: record.listing_state.clone(),
                to_state: next_state,
            });
        }
        record.listing_state = next_state;
        record.updated_at = changed_at.to_string();
        match record.listing_state {
            RuntimeAssetListingState::Live => {
                record.promoted_at = Some(changed_at.to_string());
                record.paused_at = None;
                record.deprecated_at = None;
            }
            RuntimeAssetListingState::Paused => {
                record.paused_at = Some(changed_at.to_string());
            }
            RuntimeAssetListingState::Deprecated => {
                record.deprecated_at = Some(changed_at.to_string());
            }
            _ => {}
        }
        persist_asset(&transaction, &record)?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn ensure_pair_supported(
        &self,
        deployment: &RuntimeDeploymentRecord,
    ) -> Result<SupportedPair, AssetRegistryError> {
        let connection = self.open_connection()?;
        let base_asset = load_asset_for_venue_native_id(
            &connection,
            &deployment.venue_key,
            &deployment.pair.base_mint,
        )?
        .ok_or_else(|| AssetRegistryError::VenueNativeIdNotFound {
            venue_key: deployment.venue_key.clone(),
            native_id: deployment.pair.base_mint.clone(),
        })?;
        let quote_asset = load_asset_for_venue_native_id(
            &connection,
            &deployment.venue_key,
            &deployment.pair.quote_mint,
        )?
        .ok_or_else(|| AssetRegistryError::VenueNativeIdNotFound {
            venue_key: deployment.venue_key.clone(),
            native_id: deployment.pair.quote_mint.clone(),
        })?;
        ensure_asset_mode(&base_asset, &deployment.mode)?;
        ensure_asset_mode(&quote_asset, &deployment.mode)?;
        ensure_mapping_mode(&base_asset, &deployment.venue_key, &deployment.mode)?;
        ensure_mapping_mode(&quote_asset, &deployment.venue_key, &deployment.mode)?;
        ensure_quote_pair_supported(&base_asset, &quote_asset)?;
        ensure_mapping_quote_supported(&base_asset, &quote_asset, &deployment.venue_key)?;
        Ok(SupportedPair {
            base_asset,
            quote_asset,
        })
    }

    #[must_use]
    pub fn snapshot_now(&self) -> AssetRegistrySnapshot {
        match self.snapshot_counts() {
            Ok((asset_count, live_asset_count)) => AssetRegistrySnapshot {
                status: "healthy".to_string(),
                asset_count,
                live_asset_count,
                last_error: None,
            },
            Err(error) => AssetRegistrySnapshot {
                status: "degraded".to_string(),
                asset_count: 0,
                live_asset_count: 0,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, u64), AssetRegistryError> {
        let connection = self.open_connection()?;
        let asset_count =
            connection.query_row("SELECT COUNT(*) FROM asset_records", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let live_asset_count = connection.query_row(
            "SELECT COUNT(*) FROM asset_records WHERE listing_state = 'live'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        Ok((asset_count, live_asset_count))
    }

    fn initialize_at_path(path: PathBuf) -> Result<Self, AssetRegistryError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let registry = Self {
            database_path: path.clone(),
        };
        let connection = registry.open_connection()?;
        initialize_schema(&connection)?;
        registry.seed_builtin_assets()?;
        Ok(registry)
    }

    fn seed_builtin_assets(&self) -> Result<(), AssetRegistryError> {
        for asset in builtin_assets() {
            let _ = self.upsert_asset(&asset)?;
        }
        Ok(())
    }

    fn open_connection(&self) -> Result<Connection, AssetRegistryError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}

fn builtin_assets() -> Vec<RuntimeAssetRecord> {
    let timestamp = "2026-03-10T00:00:00.000Z";
    vec![
        RuntimeAssetRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            asset_key: "SOL".to_string(),
            display_name: "Solana".to_string(),
            symbol: "SOL".to_string(),
            chain_key: "solana-mainnet".to_string(),
            canonical_id: "So11111111111111111111111111111111111111112".to_string(),
            asset_kind: RuntimeAssetKind::Native,
            risk_class: RuntimeAssetRiskClass::Core,
            listing_state: RuntimeAssetListingState::Live,
            decimals: 9,
            aliases: vec!["WSOL".to_string()],
            quote_asset_keys: vec!["USDC".to_string()],
            venue_mappings: vec![
                venue_mapping(
                    "jupiter",
                    "So11111111111111111111111111111111111111112",
                    "SOL",
                    RuntimeAssetListingState::Live,
                    9,
                ),
                venue_mapping(
                    "magicblock",
                    "So11111111111111111111111111111111111111112",
                    "SOL",
                    RuntimeAssetListingState::Paper,
                    9,
                ),
                venue_mapping(
                    "phoenix",
                    "So11111111111111111111111111111111111111112",
                    "SOL",
                    RuntimeAssetListingState::Candidate,
                    9,
                ),
            ],
            created_at: timestamp.to_string(),
            updated_at: timestamp.to_string(),
            promoted_at: Some(timestamp.to_string()),
            paused_at: None,
            deprecated_at: None,
            tags: vec!["core".to_string(), "spot".to_string(), "solana".to_string()],
            notes: Some("Seeded runtime asset registry record.".to_string()),
        },
        RuntimeAssetRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            asset_key: "USDC".to_string(),
            display_name: "USD Coin".to_string(),
            symbol: "USDC".to_string(),
            chain_key: "solana-mainnet".to_string(),
            canonical_id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            asset_kind: RuntimeAssetKind::Stablecoin,
            risk_class: RuntimeAssetRiskClass::Core,
            listing_state: RuntimeAssetListingState::Live,
            decimals: 6,
            aliases: vec!["USD Coin".to_string()],
            quote_asset_keys: vec!["USDC".to_string()],
            venue_mappings: vec![
                venue_mapping(
                    "jupiter",
                    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    "USDC",
                    RuntimeAssetListingState::Live,
                    6,
                ),
                venue_mapping(
                    "magicblock",
                    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    "USDC",
                    RuntimeAssetListingState::Paper,
                    6,
                ),
                venue_mapping(
                    "phoenix",
                    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    "USDC",
                    RuntimeAssetListingState::Candidate,
                    6,
                ),
            ],
            created_at: timestamp.to_string(),
            updated_at: timestamp.to_string(),
            promoted_at: Some(timestamp.to_string()),
            paused_at: None,
            deprecated_at: None,
            tags: vec![
                "core".to_string(),
                "stablecoin".to_string(),
                "usd".to_string(),
            ],
            notes: Some("Seeded runtime asset registry record.".to_string()),
        },
    ]
}

fn venue_mapping(
    venue_key: &str,
    native_id: &str,
    venue_symbol: &str,
    listing_state: RuntimeAssetListingState,
    decimals: u32,
) -> RuntimeAssetVenueMapping {
    RuntimeAssetVenueMapping {
        venue_key: venue_key.to_string(),
        native_id: native_id.to_string(),
        venue_symbol: venue_symbol.to_string(),
        decimals,
        listing_state,
        quote_asset_keys: vec!["USDC".to_string()],
        price_decimals: Some(6),
        size_decimals: Some(decimals),
        min_notional_usd: Some("0.01".to_string()),
        notes: Some("Seeded venue mapping.".to_string()),
    }
}

fn listing_state_supports_mode(state: &RuntimeAssetListingState, mode: &RuntimeMode) -> bool {
    match state {
        RuntimeAssetListingState::Candidate => false,
        RuntimeAssetListingState::Shadow => matches!(mode, RuntimeMode::Shadow),
        RuntimeAssetListingState::Paper => {
            matches!(mode, RuntimeMode::Shadow | RuntimeMode::Paper)
        }
        RuntimeAssetListingState::Live => true,
        RuntimeAssetListingState::Paused | RuntimeAssetListingState::Deprecated => false,
    }
}

fn can_transition_listing_state(
    from: &RuntimeAssetListingState,
    to: &RuntimeAssetListingState,
) -> bool {
    matches!(
        (from, to),
        (
            RuntimeAssetListingState::Candidate,
            RuntimeAssetListingState::Shadow
        ) | (
            RuntimeAssetListingState::Candidate,
            RuntimeAssetListingState::Paper
        ) | (
            RuntimeAssetListingState::Candidate,
            RuntimeAssetListingState::Live
        ) | (
            RuntimeAssetListingState::Candidate,
            RuntimeAssetListingState::Paused
        ) | (
            RuntimeAssetListingState::Candidate,
            RuntimeAssetListingState::Deprecated
        ) | (
            RuntimeAssetListingState::Shadow,
            RuntimeAssetListingState::Paper
        ) | (
            RuntimeAssetListingState::Shadow,
            RuntimeAssetListingState::Live
        ) | (
            RuntimeAssetListingState::Shadow,
            RuntimeAssetListingState::Paused
        ) | (
            RuntimeAssetListingState::Shadow,
            RuntimeAssetListingState::Deprecated
        ) | (
            RuntimeAssetListingState::Paper,
            RuntimeAssetListingState::Live
        ) | (
            RuntimeAssetListingState::Paper,
            RuntimeAssetListingState::Paused
        ) | (
            RuntimeAssetListingState::Paper,
            RuntimeAssetListingState::Deprecated
        ) | (
            RuntimeAssetListingState::Live,
            RuntimeAssetListingState::Paused
        ) | (
            RuntimeAssetListingState::Live,
            RuntimeAssetListingState::Deprecated
        ) | (
            RuntimeAssetListingState::Paused,
            RuntimeAssetListingState::Shadow
        ) | (
            RuntimeAssetListingState::Paused,
            RuntimeAssetListingState::Paper
        ) | (
            RuntimeAssetListingState::Paused,
            RuntimeAssetListingState::Live
        ) | (
            RuntimeAssetListingState::Paused,
            RuntimeAssetListingState::Deprecated
        )
    )
}

fn ensure_asset_mode(
    asset: &RuntimeAssetRecord,
    mode: &RuntimeMode,
) -> Result<(), AssetRegistryError> {
    if listing_state_supports_mode(&asset.listing_state, mode) {
        return Ok(());
    }
    Err(AssetRegistryError::AssetModeUnsupported {
        asset_key: asset.asset_key.clone(),
        listing_state: asset.listing_state.clone(),
        mode: mode.clone(),
    })
}

fn ensure_mapping_mode(
    asset: &RuntimeAssetRecord,
    venue_key: &str,
    mode: &RuntimeMode,
) -> Result<(), AssetRegistryError> {
    let mapping = asset
        .venue_mappings
        .iter()
        .find(|mapping| mapping.venue_key == venue_key)
        .ok_or_else(|| AssetRegistryError::VenueMappingMissing {
            asset_key: asset.asset_key.clone(),
            venue_key: venue_key.to_string(),
        })?;
    if listing_state_supports_mode(&mapping.listing_state, mode) {
        return Ok(());
    }
    Err(AssetRegistryError::VenueMappingModeUnsupported {
        asset_key: asset.asset_key.clone(),
        venue_key: venue_key.to_string(),
        listing_state: mapping.listing_state.clone(),
        mode: mode.clone(),
    })
}

fn ensure_quote_pair_supported(
    base_asset: &RuntimeAssetRecord,
    quote_asset: &RuntimeAssetRecord,
) -> Result<(), AssetRegistryError> {
    if base_asset
        .quote_asset_keys
        .iter()
        .any(|asset_key| asset_key == &quote_asset.asset_key)
    {
        return Ok(());
    }
    Err(AssetRegistryError::QuoteAssetUnsupported {
        base_asset_key: base_asset.asset_key.clone(),
        quote_asset_key: quote_asset.asset_key.clone(),
    })
}

fn ensure_mapping_quote_supported(
    base_asset: &RuntimeAssetRecord,
    quote_asset: &RuntimeAssetRecord,
    venue_key: &str,
) -> Result<(), AssetRegistryError> {
    let mapping = base_asset
        .venue_mappings
        .iter()
        .find(|mapping| mapping.venue_key == venue_key)
        .ok_or_else(|| AssetRegistryError::VenueMappingMissing {
            asset_key: base_asset.asset_key.clone(),
            venue_key: venue_key.to_string(),
        })?;
    if mapping
        .quote_asset_keys
        .iter()
        .any(|asset_key| asset_key == &quote_asset.asset_key)
    {
        return Ok(());
    }
    Err(AssetRegistryError::VenueMappingQuoteUnsupported {
        base_asset_key: base_asset.asset_key.clone(),
        quote_asset_key: quote_asset.asset_key.clone(),
        venue_key: venue_key.to_string(),
    })
}

fn validate_asset_record(record: &RuntimeAssetRecord) -> Result<(), AssetRegistryError> {
    if record.asset_key.trim().is_empty() {
        return Err(AssetRegistryError::InvalidRecord {
            asset_key: record.asset_key.clone(),
            reason: "assetKey must not be empty".to_string(),
        });
    }
    if record.venue_mappings.is_empty() {
        return Err(AssetRegistryError::InvalidRecord {
            asset_key: record.asset_key.clone(),
            reason: "venueMappings must not be empty".to_string(),
        });
    }
    Ok(())
}

fn persist_asset(
    connection: &Connection,
    record: &RuntimeAssetRecord,
) -> Result<(), AssetRegistryError> {
    connection.execute(
        "INSERT INTO asset_records (
            asset_key,
            listing_state,
            updated_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(asset_key) DO UPDATE SET
            listing_state = excluded.listing_state,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![
            record.asset_key,
            listing_state_key(&record.listing_state),
            record.updated_at,
            serialize_json(record)?,
        ],
    )?;
    connection.execute(
        "DELETE FROM asset_venue_mappings WHERE asset_key = ?1",
        params![record.asset_key],
    )?;
    for mapping in &record.venue_mappings {
        connection.execute(
            "INSERT INTO asset_venue_mappings (
                asset_key,
                venue_key,
                native_id,
                listing_state
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                record.asset_key,
                mapping.venue_key,
                mapping.native_id,
                listing_state_key(&mapping.listing_state),
            ],
        )?;
    }
    Ok(())
}

fn load_asset(
    connection: &Connection,
    asset_key: &str,
) -> Result<Option<RuntimeAssetRecord>, AssetRegistryError> {
    connection
        .query_row(
            "SELECT record_json FROM asset_records WHERE asset_key = ?1",
            params![asset_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn load_asset_for_venue_native_id(
    connection: &Connection,
    venue_key: &str,
    native_id: &str,
) -> Result<Option<RuntimeAssetRecord>, AssetRegistryError> {
    connection
        .query_row(
            "SELECT a.record_json
             FROM asset_records a
             INNER JOIN asset_venue_mappings m
               ON m.asset_key = a.asset_key
             WHERE m.venue_key = ?1
               AND m.native_id = ?2",
            params![venue_key, native_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn initialize_schema(connection: &Connection) -> Result<(), AssetRegistryError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS asset_records (
            asset_key TEXT PRIMARY KEY,
            listing_state TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS asset_venue_mappings (
            asset_key TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            native_id TEXT NOT NULL,
            listing_state TEXT NOT NULL,
            PRIMARY KEY (asset_key, venue_key, native_id),
            FOREIGN KEY (asset_key) REFERENCES asset_records(asset_key) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_asset_records_listing_state
            ON asset_records (listing_state, updated_at DESC, asset_key DESC);
        CREATE INDEX IF NOT EXISTS idx_asset_venue_mappings_lookup
            ON asset_venue_mappings (venue_key, native_id);
        CREATE INDEX IF NOT EXISTS idx_asset_venue_mappings_venue
            ON asset_venue_mappings (venue_key, listing_state, asset_key);",
    )?;
    Ok(())
}

fn listing_state_key(state: &RuntimeAssetListingState) -> &'static str {
    match state {
        RuntimeAssetListingState::Candidate => "candidate",
        RuntimeAssetListingState::Shadow => "shadow",
        RuntimeAssetListingState::Paper => "paper",
        RuntimeAssetListingState::Live => "live",
        RuntimeAssetListingState::Paused => "paused",
        RuntimeAssetListingState::Deprecated => "deprecated",
    }
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    let without_scheme = trimmed
        .strip_prefix("sqlite://")
        .or_else(|| trimmed.strip_prefix("file:"))
        .unwrap_or(trimmed);
    let candidate = PathBuf::from(without_scheme);
    if candidate.is_absolute() {
        candidate
    } else {
        PathBuf::from(".").join(candidate)
    }
}

fn fallback_database_path() -> PathBuf {
    std::env::temp_dir().join("runtime-rs/asset-registry.sqlite3")
}

fn should_fallback_to_tmp(path: &Path, error: &AssetRegistryError) -> bool {
    !path.starts_with(std::env::temp_dir()) && matches!(error, AssetRegistryError::Io(_))
}

fn serialize_json<T>(value: &T) -> Result<String, AssetRegistryError>
where
    T: Serialize,
{
    Ok(serde_json::to_string(value)?)
}

fn deserialize_json<T>(value: &str) -> Result<T, AssetRegistryError>
where
    T: for<'de> Deserialize<'de>,
{
    Ok(serde_json::from_str(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(name: &str) -> AssetRegistry {
        let database_url = format!(".tmp/tests/asset-registry/{name}.sqlite3");
        AssetRegistry::new(AssetRegistryConfig::new(database_url)).expect("registry")
    }

    #[test]
    fn seeds_builtin_assets_and_queries_by_venue() {
        let registry = registry("seed");
        let jupiter_assets = registry
            .list_assets(&AssetRegistryQuery {
                venue_key: Some("jupiter".to_string()),
                ..AssetRegistryQuery::default()
            })
            .expect("jupiter assets");
        assert!(jupiter_assets.iter().any(|asset| asset.asset_key == "SOL"));
        assert!(jupiter_assets.iter().any(|asset| asset.asset_key == "USDC"));
    }

    #[test]
    fn ensures_pair_support_for_live_jupiter_deployments() {
        let registry = registry("pair");
        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_live_sol".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "jupiter".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: protocol::RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Live,
            state: protocol::RuntimeDeploymentState::Live,
            lane: protocol::RuntimeLane::Safe,
            created_at: "2026-03-10T00:00:00.000Z".to_string(),
            updated_at: "2026-03-10T00:00:00.000Z".to_string(),
            promoted_at: Some("2026-03-10T00:00:00.000Z".to_string()),
            paused_at: None,
            killed_at: None,
            policy: protocol::RuntimePolicy {
                max_notional_usd: "5.00".to_string(),
                daily_loss_limit_usd: "25.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: protocol::RuntimeCapital {
                allocated_usd: "25.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "20.00".to_string(),
            },
            tags: vec!["test".to_string()],
        };

        let supported = registry
            .ensure_pair_supported(&deployment)
            .expect("pair supported");
        assert_eq!(supported.base_asset.asset_key, "SOL");
        assert_eq!(supported.quote_asset.asset_key, "USDC");
    }

    #[test]
    fn blocks_live_when_venue_mapping_is_not_live_ready() {
        let registry = registry("venue-mode");
        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_live_sol_magicblock".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "magicblock".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: protocol::RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Live,
            state: protocol::RuntimeDeploymentState::Live,
            lane: protocol::RuntimeLane::Safe,
            created_at: "2026-03-10T00:00:00.000Z".to_string(),
            updated_at: "2026-03-10T00:00:00.000Z".to_string(),
            promoted_at: Some("2026-03-10T00:00:00.000Z".to_string()),
            paused_at: None,
            killed_at: None,
            policy: protocol::RuntimePolicy {
                max_notional_usd: "5.00".to_string(),
                daily_loss_limit_usd: "25.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: protocol::RuntimeCapital {
                allocated_usd: "25.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "20.00".to_string(),
            },
            tags: vec!["test".to_string()],
        };

        let error = registry
            .ensure_pair_supported(&deployment)
            .expect_err("blocked");
        assert!(matches!(
            error,
            AssetRegistryError::VenueMappingModeUnsupported { .. }
        ));
    }

    #[test]
    fn blocks_pairs_when_base_asset_disallows_the_quote_asset() {
        let registry = registry("quote-allowlist");
        let mut sol_asset = registry
            .get_asset("SOL")
            .expect("asset lookup")
            .expect("sol asset");
        sol_asset.quote_asset_keys = vec!["USDT".to_string()];
        registry.upsert_asset(&sol_asset).expect("asset update");

        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_live_sol_wrong_quote".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "jupiter".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: protocol::RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Live,
            state: protocol::RuntimeDeploymentState::Live,
            lane: protocol::RuntimeLane::Safe,
            created_at: "2026-03-10T00:00:00.000Z".to_string(),
            updated_at: "2026-03-10T00:00:00.000Z".to_string(),
            promoted_at: Some("2026-03-10T00:00:00.000Z".to_string()),
            paused_at: None,
            killed_at: None,
            policy: protocol::RuntimePolicy {
                max_notional_usd: "5.00".to_string(),
                daily_loss_limit_usd: "25.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: protocol::RuntimeCapital {
                allocated_usd: "25.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "20.00".to_string(),
            },
            tags: vec!["test".to_string()],
        };

        let error = registry
            .ensure_pair_supported(&deployment)
            .expect_err("quote allowlist mismatch");
        assert!(matches!(
            error,
            AssetRegistryError::QuoteAssetUnsupported { .. }
        ));
    }

    #[test]
    fn blocks_pairs_when_venue_mapping_disallows_the_quote_asset() {
        let registry = registry("mapping-quote-allowlist");
        let mut sol_asset = registry
            .get_asset("SOL")
            .expect("asset lookup")
            .expect("sol asset");
        let mapping = sol_asset
            .venue_mappings
            .iter_mut()
            .find(|mapping| mapping.venue_key == "jupiter")
            .expect("jupiter mapping");
        mapping.quote_asset_keys = vec!["USDT".to_string()];
        registry.upsert_asset(&sol_asset).expect("asset update");

        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_live_sol_mapping_quote".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "jupiter".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: protocol::RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Live,
            state: protocol::RuntimeDeploymentState::Live,
            lane: protocol::RuntimeLane::Safe,
            created_at: "2026-03-10T00:00:00.000Z".to_string(),
            updated_at: "2026-03-10T00:00:00.000Z".to_string(),
            promoted_at: Some("2026-03-10T00:00:00.000Z".to_string()),
            paused_at: None,
            killed_at: None,
            policy: protocol::RuntimePolicy {
                max_notional_usd: "5.00".to_string(),
                daily_loss_limit_usd: "25.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: protocol::RuntimeCapital {
                allocated_usd: "25.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "20.00".to_string(),
            },
            tags: vec!["test".to_string()],
        };

        let error = registry
            .ensure_pair_supported(&deployment)
            .expect_err("mapping quote allowlist mismatch");
        assert!(matches!(
            error,
            AssetRegistryError::VenueMappingQuoteUnsupported { .. }
        ));
    }
}
