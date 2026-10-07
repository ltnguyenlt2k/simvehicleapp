//! ADR-0047 spike: kuksa.val.v2 on databroker 0.5.0 — read, actuate without/with a provider, provider publishes current.
use kuksa_rust_sdk::v2_proto::{
    self as v2, open_provider_stream_request::Action as Req, open_provider_stream_response::Action as Resp,
    signal_id::Signal, val_client::ValClient, value::TypedValue,
};
use std::time::Instant;
use tokio_stream::StreamExt;

const HAZARD: &str = "Vehicle.Body.Lights.Hazard.IsSignaling";
fn id(p: &str) -> Option<v2::SignalId> {
    Some(v2::SignalId { signal: Some(Signal::Path(p.into())) })
}
fn boolean(b: bool) -> Option<v2::Value> {
    Some(v2::Value { typed_value: Some(TypedValue::Bool(b)) })
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let url = std::env::args().nth(1).unwrap_or("http://sv-spike-vdb:55555".into());
    let mut c = ValClient::connect(url.clone()).await.expect("connect");
    let info = c.get_server_info(v2::GetServerInfoRequest {}).await.expect("server info").into_inner();
    println!("1 server: {} {}", info.name, info.version);

    let r = c.get_value(v2::GetValueRequest { signal_id: id(HAZARD) }).await;
    println!("2 get_value hazard (never set): {:?}", r.map(|x| x.into_inner().data_point));

    let r = c.actuate(v2::ActuateRequest { signal_id: id(HAZARD), value: boolean(true) }).await;
    println!("3 actuate without provider: {:?}", r.map(|_| "ok").map_err(|e| (e.code(), e.message().to_string())));

    let r = c.actuate(v2::ActuateRequest { signal_id: id("Vehicle.Speed"), value: Some(v2::Value { typed_value: Some(TypedValue::Float(1.0)) }) }).await;
    println!("4 actuate a sensor: {:?}", r.map(|_| "ok").map_err(|e| e.code()));

    // provider: claim the hazard actuator, answer actuations by publishing the value as current
    let (tx, rx) = tokio::sync::mpsc::channel::<v2::OpenProviderStreamRequest>(8);
    tx.send(v2::OpenProviderStreamRequest { action: Some(Req::ProvideActuationRequest(v2::ProvideActuationRequest { actuator_identifiers: vec![id(HAZARD).unwrap()] })) }).await.unwrap();
    let mut p = ValClient::connect(url.clone()).await.unwrap();
    let mut stream = p.open_provider_stream(tokio_stream::wrappers::ReceiverStream::new(rx)).await.expect("provider stream").into_inner();
    let first = stream.next().await;
    println!("5 provide_actuation: {:?}", first.map(|m| m.map(|x| matches!(x.action, Some(Resp::ProvideActuationResponse(_))))));
    let mut publisher = ValClient::connect(url.clone()).await.unwrap();
    let provider = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            if let Some(Resp::BatchActuateStreamRequest(b)) = msg.action {
                for a in b.actuate_requests {
                    println!("  provider got actuation {:?} = {:?}", a.signal_id.as_ref().and_then(|s| s.signal.clone()), a.value.as_ref().and_then(|v| v.typed_value.clone()));
                    let r = publisher.publish_value(v2::PublishValueRequest { signal_id: a.signal_id.clone(), data_point: Some(v2::Datapoint { timestamp: None, value: a.value.clone() }) }).await;
                    println!("  provider publish_value current: {:?}", r.map(|_| "ok").map_err(|e| e.code()));
                }
            }
        }
    });

    // a second provider for the same actuator is refused
    let (tx2, rx2) = tokio::sync::mpsc::channel::<v2::OpenProviderStreamRequest>(1);
    tx2.send(v2::OpenProviderStreamRequest { action: Some(Req::ProvideActuationRequest(v2::ProvideActuationRequest { actuator_identifiers: vec![id(HAZARD).unwrap()] })) }).await.unwrap();
    let mut p2 = ValClient::connect(url.clone()).await.unwrap();
    let second = match p2.open_provider_stream(tokio_stream::wrappers::ReceiverStream::new(rx2)).await {
        Ok(s) => format!("{:?}", s.into_inner().next().await.map(|m| m.map(|_| "accepted").map_err(|e| e.code()))),
        Err(e) => format!("{:?}", e.code()),
    };
    println!("6 second provider for the same actuator: {second}");

    let t0 = Instant::now();
    let r = c.actuate(v2::ActuateRequest { signal_id: id(HAZARD), value: boolean(true) }).await;
    println!("7 actuate with provider: {:?} in {} ms", r.map(|_| "ok").map_err(|e| e.code()), t0.elapsed().as_millis());
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let r = c.get_value(v2::GetValueRequest { signal_id: id(HAZARD) }).await;
    println!("8 get_value hazard after actuation: {:?}", r.map(|x| x.into_inner().data_point.and_then(|d| d.value).and_then(|v| v.typed_value)));
    provider.abort();
    drop(tx);
}
