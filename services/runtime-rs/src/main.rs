use runtime_ops::RuntimeConfig;
use runtime_rs::app;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = RuntimeConfig::from_env()?;
    let filter =
        EnvFilter::try_new(config.log_level.clone()).unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let listener = tokio::net::TcpListener::bind(config.socket_addr()?).await?;
    info!(
      bind_address = %config.bind_address,
      environment = %config.environment.as_str(),
      "runtime-rs skeleton listening",
    );

    axum::serve(listener, app(config)).await?;
    Ok(())
}
