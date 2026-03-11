use std::collections::BTreeMap;

use protocol::{
    RuntimeLane, RuntimeMode, RuntimeOnboardingState, RuntimeStrategyAssetConstraint,
    RuntimeStrategyAssetRole, RuntimeStrategyCategory, RuntimeStrategyFeatureRequirement,
    RuntimeStrategyParameterKind, RuntimeStrategyParameterSpec, RuntimeStrategyPromotionPolicy,
    RuntimeStrategySpec, RuntimeStrategyVenueSupport, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategyKind {
    Dca,
    ThresholdRebalance,
    Twap,
    TrendFollowing,
    MeanReversion,
    Breakout,
    MacroRotation,
    VolatilityTarget,
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
            Self::Breakout => "breakout",
            Self::MacroRotation => "macro_rotation",
            Self::VolatilityTarget => "volatility_target",
        }
    }

    fn title(&self) -> &'static str {
        match self {
            Self::Dca => "Dollar-cost averaging",
            Self::ThresholdRebalance => "Threshold rebalance",
            Self::Twap => "Time-weighted average price",
            Self::TrendFollowing => "Trend following",
            Self::MeanReversion => "Mean reversion",
            Self::Breakout => "Breakout",
            Self::MacroRotation => "Macro rotation",
            Self::VolatilityTarget => "Volatility target",
        }
    }

    fn summary(&self) -> &'static str {
        match self {
            Self::Dca => {
                "Accumulates a base sleeve with fixed notional slices under reserve budgets."
            }
            Self::ThresholdRebalance => {
                "Rebalances toward a target sleeve split when drift exceeds tolerance."
            }
            Self::Twap => {
                "Slices the deployment budget over multiple runs using maxConcurrentRuns."
            }
            Self::TrendFollowing => {
                "Follows the short-window return direction from the feature cache."
            }
            Self::MeanReversion => {
                "Fades the short-window return direction from the feature cache."
            }
            Self::Breakout => {
                "Requires short-window momentum plus long-window confirmation before it moves risk."
            }
            Self::MacroRotation => {
                "Uses long-window regime with short-window alignment to rotate exposure."
            }
            Self::VolatilityTarget => {
                "Targets base exposure from realized volatility and rebalances toward that budget."
            }
        }
    }

    fn category(&self) -> RuntimeStrategyCategory {
        match self {
            Self::Dca | Self::ThresholdRebalance | Self::Twap => {
                RuntimeStrategyCategory::Allocation
            }
            Self::TrendFollowing | Self::MeanReversion => RuntimeStrategyCategory::Signal,
            Self::Breakout | Self::MacroRotation | Self::VolatilityTarget => {
                RuntimeStrategyCategory::Advanced
            }
        }
    }

    fn lane_eligibility(&self) -> Vec<RuntimeLane> {
        match self.category() {
            RuntimeStrategyCategory::Allocation => {
                vec![RuntimeLane::Safe, RuntimeLane::Protected, RuntimeLane::Fast]
            }
            RuntimeStrategyCategory::Signal | RuntimeStrategyCategory::Advanced => {
                vec![RuntimeLane::Safe, RuntimeLane::Protected]
            }
        }
    }

    fn supported_modes(&self) -> Vec<RuntimeMode> {
        vec![RuntimeMode::Shadow, RuntimeMode::Paper, RuntimeMode::Live]
    }

    fn supported_venues(&self) -> Vec<RuntimeStrategyVenueSupport> {
        vec![RuntimeStrategyVenueSupport {
            venue_key: "jupiter".to_string(),
            onboarding_state: RuntimeOnboardingState::BroadLiveReady,
            notes: Some(
                "Current runtime execution and canary coverage is bounded to the Jupiter bridge."
                    .to_string(),
            ),
        }]
    }

    fn asset_constraints(&self) -> Vec<RuntimeStrategyAssetConstraint> {
        vec![
            RuntimeStrategyAssetConstraint {
                role: RuntimeStrategyAssetRole::Base,
                asset_keys: Vec::new(),
                required: true,
                notes: Some(
                    "The base asset is selected from the deployment pair at registration time."
                        .to_string(),
                ),
            },
            RuntimeStrategyAssetConstraint {
                role: RuntimeStrategyAssetRole::Quote,
                asset_keys: vec!["USDC".to_string()],
                required: true,
                notes: Some(
                    "The quote leg must remain USD-denominated for current budgeting and canary controls."
                        .to_string(),
                ),
            },
        ]
    }

    fn feature_requirements(&self) -> Vec<RuntimeStrategyFeatureRequirement> {
        match self {
            Self::Dca | Self::ThresholdRebalance | Self::Twap => Vec::new(),
            Self::TrendFollowing | Self::MeanReversion => vec![feature_requirement(
                "short_return_bps",
                20_000,
                "Requires fresh short-window return inputs for every evaluation.",
            )],
            Self::Breakout | Self::MacroRotation => vec![
                feature_requirement(
                    "short_return_bps",
                    20_000,
                    "Short-window return drives trigger direction.",
                ),
                feature_requirement(
                    "long_return_bps",
                    20_000,
                    "Long-window confirmation gates the advanced signal decision.",
                ),
            ],
            Self::VolatilityTarget => vec![feature_requirement(
                "realized_volatility_bps",
                20_000,
                "Realized volatility drives the target base-exposure budget.",
            )],
        }
    }

    fn parameter_specs(&self) -> Vec<RuntimeStrategyParameterSpec> {
        let mut parameters = vec![
            decimal_parameter(
                "policy.max_notional_usd",
                "Max notional USD",
                true,
                Some("25"),
                Some("0.01"),
                None,
                "Upper bound for any single evaluation or slice.",
            ),
            bps_parameter(
                "policy.max_slippage_bps",
                "Max slippage bps",
                true,
                Some("50"),
                Some("1"),
                Some("250"),
                "Execution slippage ceiling enforced by the runtime bridge.",
            ),
            decimal_parameter(
                "policy.daily_loss_limit_usd",
                "Daily loss limit USD",
                true,
                Some("10"),
                Some("0"),
                None,
                "Daily stop-loss cap enforced by runtime risk controls.",
            ),
        ];

        match self {
            Self::ThresholdRebalance => parameters.push(bps_parameter(
                "policy.rebalance_tolerance_bps",
                "Rebalance tolerance bps",
                true,
                Some("125"),
                Some("1"),
                Some("2500"),
                "Minimum drift required before the rebalance sleeve takes action.",
            )),
            Self::Twap => parameters.push(integer_parameter(
                "policy.max_concurrent_runs",
                "Max concurrent runs",
                true,
                Some("2"),
                Some("1"),
                Some("32"),
                "Used to derive per-run TWAP slices from the deployment budget.",
            )),
            _ => {}
        }

        parameters
    }

    fn promotion_policy(&self) -> RuntimeStrategyPromotionPolicy {
        match self.category() {
            RuntimeStrategyCategory::Allocation => RuntimeStrategyPromotionPolicy {
                requires_human_approval: true,
                shadow_min_runs: 3,
                paper_min_runs: 5,
                live_lane_allowlist: vec![RuntimeLane::Safe, RuntimeLane::Protected],
                requires_fresh_features: false,
                limited_live_only: false,
                notes: Some(
                    "Allocation templates can progress to broader live use after bounded live validation."
                        .to_string(),
                ),
            },
            RuntimeStrategyCategory::Signal => RuntimeStrategyPromotionPolicy {
                requires_human_approval: true,
                shadow_min_runs: 5,
                paper_min_runs: 7,
                live_lane_allowlist: vec![RuntimeLane::Safe],
                requires_fresh_features: true,
                limited_live_only: true,
                notes: Some(
                    "Signal-driven templates require fresh features and remain bounded to safe-lane live rollout."
                        .to_string(),
                ),
            },
            RuntimeStrategyCategory::Advanced => RuntimeStrategyPromotionPolicy {
                requires_human_approval: true,
                shadow_min_runs: 5,
                paper_min_runs: 7,
                live_lane_allowlist: vec![RuntimeLane::Safe],
                requires_fresh_features: true,
                limited_live_only: true,
                notes: Some(
                    "Advanced templates stay in bounded live until they clear an explicit limited-live soak."
                        .to_string(),
                ),
            },
        }
    }

    #[must_use]
    pub fn spec(&self) -> RuntimeStrategySpec {
        RuntimeStrategySpec {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            strategy_key: self.as_key().to_string(),
            title: self.title().to_string(),
            summary: self.summary().to_string(),
            category: self.category(),
            plugin_key: format!("builtin::{}", self.as_key()),
            default_lane: RuntimeLane::Safe,
            supported_modes: self.supported_modes(),
            lane_eligibility: self.lane_eligibility(),
            supported_venues: self.supported_venues(),
            asset_constraints: self.asset_constraints(),
            feature_requirements: self.feature_requirements(),
            parameter_specs: self.parameter_specs(),
            promotion_policy: self.promotion_policy(),
            tags: vec![
                "builtin".to_string(),
                match self.category() {
                    RuntimeStrategyCategory::Allocation => "allocation".to_string(),
                    RuntimeStrategyCategory::Signal => "signal".to_string(),
                    RuntimeStrategyCategory::Advanced => "advanced".to_string(),
                },
            ],
        }
    }
}

pub const SUPPORTED_STRATEGIES: [StrategyKind; 8] = [
    StrategyKind::Dca,
    StrategyKind::ThresholdRebalance,
    StrategyKind::Twap,
    StrategyKind::TrendFollowing,
    StrategyKind::MeanReversion,
    StrategyKind::Breakout,
    StrategyKind::MacroRotation,
    StrategyKind::VolatilityTarget,
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StrategyCatalog {
    specs: BTreeMap<String, RuntimeStrategySpec>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum StrategyCatalogError {
    #[error("strategy {0} is already registered")]
    DuplicateStrategy(String),
    #[error("invalid strategy spec for {strategy_key}: {reason}")]
    InvalidSpec {
        strategy_key: String,
        reason: String,
    },
}

impl StrategyCatalog {
    pub fn builtin() -> Result<Self, StrategyCatalogError> {
        let mut catalog = Self::default();
        for strategy in SUPPORTED_STRATEGIES {
            catalog.register_spec(strategy.spec())?;
        }
        Ok(catalog)
    }

    pub fn register_spec(&mut self, spec: RuntimeStrategySpec) -> Result<(), StrategyCatalogError> {
        validate_spec(&spec)?;
        if self.specs.contains_key(&spec.strategy_key) {
            return Err(StrategyCatalogError::DuplicateStrategy(spec.strategy_key));
        }
        self.specs.insert(spec.strategy_key.clone(), spec);
        Ok(())
    }

    #[must_use]
    pub fn get(&self, strategy_key: &str) -> Option<&RuntimeStrategySpec> {
        self.specs.get(strategy_key)
    }

    pub fn require(
        &self,
        strategy_key: &str,
    ) -> Result<&RuntimeStrategySpec, StrategyCatalogError> {
        self.get(strategy_key)
            .ok_or_else(|| StrategyCatalogError::InvalidSpec {
                strategy_key: strategy_key.to_string(),
                reason: "strategy is not registered".to_string(),
            })
    }

    #[must_use]
    pub fn keys(&self) -> Vec<String> {
        self.specs.keys().cloned().collect()
    }

    #[must_use]
    pub fn specs(&self) -> Vec<RuntimeStrategySpec> {
        self.specs.values().cloned().collect()
    }
}

fn validate_spec(spec: &RuntimeStrategySpec) -> Result<(), StrategyCatalogError> {
    if spec.strategy_key.trim().is_empty() {
        return Err(invalid_spec(spec, "strategyKey must not be empty"));
    }
    if spec.plugin_key.trim().is_empty() {
        return Err(invalid_spec(spec, "pluginKey must not be empty"));
    }
    if spec.supported_modes.is_empty() {
        return Err(invalid_spec(spec, "supportedModes must not be empty"));
    }
    if spec.lane_eligibility.is_empty() {
        return Err(invalid_spec(spec, "laneEligibility must not be empty"));
    }
    if !spec.lane_eligibility.contains(&spec.default_lane) {
        return Err(invalid_spec(
            spec,
            "defaultLane must be included in laneEligibility",
        ));
    }
    if spec.supported_venues.is_empty() {
        return Err(invalid_spec(spec, "supportedVenues must not be empty"));
    }
    if spec.asset_constraints.is_empty() {
        return Err(invalid_spec(spec, "assetConstraints must not be empty"));
    }
    if spec
        .promotion_policy
        .live_lane_allowlist
        .iter()
        .any(|lane| !spec.lane_eligibility.contains(lane))
    {
        return Err(invalid_spec(
            spec,
            "promotionPolicy.liveLaneAllowlist must be a subset of laneEligibility",
        ));
    }
    for parameter in &spec.parameter_specs {
        if parameter.kind == RuntimeStrategyParameterKind::Enum
            && parameter.allowed_values.is_empty()
        {
            return Err(invalid_spec(
                spec,
                "enum parameters must declare allowedValues",
            ));
        }
    }
    Ok(())
}

fn invalid_spec(spec: &RuntimeStrategySpec, reason: &str) -> StrategyCatalogError {
    StrategyCatalogError::InvalidSpec {
        strategy_key: spec.strategy_key.clone(),
        reason: reason.to_string(),
    }
}

fn feature_requirement(
    feature_key: &str,
    freshness_ms: u64,
    notes: &str,
) -> RuntimeStrategyFeatureRequirement {
    RuntimeStrategyFeatureRequirement {
        feature_key: feature_key.to_string(),
        required: true,
        freshness_ms: Some(freshness_ms),
        notes: Some(notes.to_string()),
    }
}

fn decimal_parameter(
    key: &str,
    label: &str,
    required: bool,
    default_value: Option<&str>,
    min_value: Option<&str>,
    max_value: Option<&str>,
    notes: &str,
) -> RuntimeStrategyParameterSpec {
    parameter_spec(
        key,
        label,
        RuntimeStrategyParameterKind::Decimal,
        required,
        default_value,
        min_value,
        max_value,
        &[],
        notes,
    )
}

fn integer_parameter(
    key: &str,
    label: &str,
    required: bool,
    default_value: Option<&str>,
    min_value: Option<&str>,
    max_value: Option<&str>,
    notes: &str,
) -> RuntimeStrategyParameterSpec {
    parameter_spec(
        key,
        label,
        RuntimeStrategyParameterKind::Integer,
        required,
        default_value,
        min_value,
        max_value,
        &[],
        notes,
    )
}

fn bps_parameter(
    key: &str,
    label: &str,
    required: bool,
    default_value: Option<&str>,
    min_value: Option<&str>,
    max_value: Option<&str>,
    notes: &str,
) -> RuntimeStrategyParameterSpec {
    parameter_spec(
        key,
        label,
        RuntimeStrategyParameterKind::Bps,
        required,
        default_value,
        min_value,
        max_value,
        &[],
        notes,
    )
}

#[allow(clippy::too_many_arguments)]
fn parameter_spec(
    key: &str,
    label: &str,
    kind: RuntimeStrategyParameterKind,
    required: bool,
    default_value: Option<&str>,
    min_value: Option<&str>,
    max_value: Option<&str>,
    allowed_values: &[&str],
    notes: &str,
) -> RuntimeStrategyParameterSpec {
    RuntimeStrategyParameterSpec {
        key: key.to_string(),
        label: label.to_string(),
        kind,
        required,
        default_value: default_value.map(str::to_string),
        min_value: min_value.map(str::to_string),
        max_value: max_value.map(str::to_string),
        allowed_values: allowed_values
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        notes: Some(notes.to_string()),
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
                "breakout",
                "macro_rotation",
                "volatility_target",
            ],
        );
    }

    #[test]
    fn builds_builtin_catalog_with_strategy_specs() {
        let catalog = StrategyCatalog::builtin().expect("builtin catalog");
        let trend = catalog.get("trend_following").expect("trend spec");

        assert_eq!(catalog.keys().len(), 8);
        assert_eq!(trend.category, RuntimeStrategyCategory::Signal);
        assert_eq!(trend.feature_requirements.len(), 1);
        assert_eq!(
            trend.promotion_policy.live_lane_allowlist,
            vec![RuntimeLane::Safe]
        );
    }

    #[test]
    fn rejects_invalid_specs() {
        let mut catalog = StrategyCatalog::default();
        let mut spec = StrategyKind::Dca.spec();
        spec.lane_eligibility = vec![RuntimeLane::Protected];

        let error = catalog
            .register_spec(spec)
            .expect_err("spec validation should fail");

        assert!(matches!(error, StrategyCatalogError::InvalidSpec { .. }));
    }
}
