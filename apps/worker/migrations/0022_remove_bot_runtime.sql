PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS backtest_run_events;
DROP TABLE IF EXISTS backtest_runs;
DROP TABLE IF EXISTS strategy_events;
DROP TABLE IF EXISTS strategy_runtime_state;
DROP TABLE IF EXISTS strategy_validations;
DROP TABLE IF EXISTS bot_conversations;
DROP TABLE IF EXISTS bot_steering_messages;
DROP TABLE IF EXISTS bot_agent_memory;
DROP TABLE IF EXISTS bot_run_state;
DROP TABLE IF EXISTS bot_prediction_provider;
DROP TABLE IF EXISTS bot_inference_providers;
DROP TABLE IF EXISTS trade_index;
DROP TABLE IF EXISTS loop_configs;
DROP TABLE IF EXISTS bots;

PRAGMA foreign_keys = ON;
