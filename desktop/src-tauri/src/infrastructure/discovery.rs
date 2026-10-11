use super::{AdbCommandExecutor, AdbWirelessConnectionService, BookmarkStore};
use crate::domain::*;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

struct DiscoveryCache {
    resolved_services: HashMap<String, WirelessService>,
    next_connect_times: HashMap<String, Instant>,
}
pub struct AdbDeviceDiscovery {
    executor: Arc<dyn AdbCommandExecutor>,
    store: Arc<dyn BookmarkStore>,
    cache: Mutex<DiscoveryCache>,
}
impl AdbDeviceDiscovery {
    pub fn new(executor: Arc<dyn AdbCommandExecutor>, store: Arc<dyn BookmarkStore>) -> Self {
        Self {
            executor,
            store,
            cache: Mutex::new(DiscoveryCache {
                resolved_services: HashMap::new(),
                next_connect_times: HashMap::new(),
            }),
        }
    }
    pub async fn discover(
        &self,
        cancellation: CancellationToken,
    ) -> Result<Vec<PhoneDevice>, String> {
        // Serialize complete scans: late results cannot replace a newer endpoint.
        let mut cache = tokio::select! { _ = cancellation.cancelled() => return Err("기기 검색을 취소했습니다.".into()), cache = self.cache.lock() => cache };
        let mut list = self
            .executor
            .execute(
                vec!["devices".into(), "-l".into()],
                None,
                cancellation.clone(),
            )
            .await?;
        if !list.success {
            return Err("기기 검색 실패. ADB 연결을 확인하세요.".into());
        }
        let service_result = self
            .executor
            .execute(
                vec!["mdns".into(), "services".into()],
                None,
                cancellation.clone(),
            )
            .await;
        let mut services = service_result
            .ok()
            .filter(|result| result.success)
            .map(|result| parse_services(&result.output))
            .unwrap_or_default();
        if cancellation.is_cancelled() {
            return Err("기기 검색을 취소했습니다.".into());
        }
        services.sort_by(|a, b| {
            b.instance_number()
                .cmp(&a.instance_number())
                .then_with(|| a.name.cmp(&b.name))
        });
        let mut transports = parse_transports(&list.output);
        let mut bookmarks = self.store.load()?;
        let mut connected = false;
        for bookmark in &bookmarks {
            let Some(service) = services.iter().find(|service| {
                service.kind == WirelessServiceKind::Connection
                    && bookmark.matches_service(&service.name)
            }) else {
                continue;
            };
            if transports.iter().any(|transport| {
                transport.availability == DeviceAvailability::Ready
                    && service.matches_identifier(&transport.identifier)
            }) {
                continue;
            }
            if cache
                .next_connect_times
                .get(&bookmark.service_name)
                .is_some_and(|time| *time > Instant::now())
            {
                continue;
            }
            cache.next_connect_times.insert(
                bookmark.service_name.clone(),
                Instant::now() + Duration::from_secs(4),
            );
            if AdbWirelessConnectionService::new(self.executor.clone())
                .connect(&service.address, cancellation.clone())
                .await
                .is_ok()
            {
                connected = true;
            }
        }
        if connected {
            list = self
                .executor
                .execute(
                    vec!["devices".into(), "-l".into()],
                    None,
                    cancellation.clone(),
                )
                .await?;
            if list.success {
                transports = parse_transports(&list.output);
            }
        }
        let identifiers: HashSet<_> = transports
            .iter()
            .map(|transport| transport.identifier.clone())
            .collect();
        cache
            .resolved_services
            .retain(|identifier, _| identifiers.contains(identifier));
        for transport in &transports {
            if let Some(service) = services.iter().find(|service| {
                service.kind == WirelessServiceKind::Connection
                    && service.matches_identifier(&transport.identifier)
            }) {
                cache
                    .resolved_services
                    .insert(transport.identifier.clone(), service.clone());
            }
        }
        transports.sort_by(|left, right| {
            let priority = |transport: &AdbTransport| {
                (
                    u8::from(transport.transport == ConnectionTransport::Usb),
                    cache
                        .resolved_services
                        .get(&transport.identifier)
                        .map_or(0, WirelessService::instance_number),
                    u8::from(transport.identifier.contains("._adb-tls-connect._tcp")),
                )
            };
            priority(right)
                .cmp(&priority(left))
                .then_with(|| left.identifier.cmp(&right.identifier))
        });
        let mut devices = Vec::new();
        let mut seen = HashSet::new();
        for transport in transports {
            let mut identity = transport.identifier.clone();
            if transport.transport == ConnectionTransport::Wifi {
                if transport.availability != DeviceAvailability::Ready {
                    continue;
                }
                let serial = self
                    .executor
                    .execute(
                        vec![
                            "-s".into(),
                            transport.identifier.clone(),
                            "shell".into(),
                            "getprop".into(),
                            "ro.serialno".into(),
                        ],
                        None,
                        cancellation.clone(),
                    )
                    .await;
                let Ok(serial) = serial else {
                    if cancellation.is_cancelled() {
                        return Err("기기 검색을 취소했습니다.".into());
                    }
                    continue;
                };
                identity = serial.output.trim().into();
                if !serial.success
                    || !valid_identity(&identity)
                    || identity.eq_ignore_ascii_case("unknown")
                    || WirelessEndpoint::parse(&identity).is_ok()
                {
                    continue;
                }
                if seen.contains(&format!("wifi:{identity}")) {
                    continue;
                }
                let guid = self
                    .executor
                    .execute(
                        vec![
                            "-s".into(),
                            transport.identifier.clone(),
                            "shell".into(),
                            "getprop".into(),
                            "persist.adb.wifi.guid".into(),
                        ],
                        None,
                        cancellation.clone(),
                    )
                    .await;
                let service_name = guid
                    .ok()
                    .filter(|result| result.success && !result.output.trim().is_empty())
                    .map(|result| format!("adb-{}", result.output.trim()))
                    .or_else(|| {
                        cache
                            .resolved_services
                            .get(&transport.identifier)
                            .map(|service| service.name.clone())
                    });
                if let Some(service_name) = service_name {
                    if bookmarks.iter().any(|bookmark| {
                        bookmark.matches_service(&service_name) && bookmark.identity != identity
                    }) {
                        continue;
                    }
                    let bookmark = WirelessBookmark {
                        identity: identity.clone(),
                        name: transport.name.clone(),
                        service_name,
                    };
                    if bookmark.is_valid() {
                        bookmarks.retain(|value| value.identity != identity);
                        bookmarks.push(bookmark);
                    }
                }
            }
            let target = ConnectionTarget {
                identity: identity.clone(),
                transport: transport.transport,
            };
            let address = cache
                .resolved_services
                .get(&transport.identifier)
                .map_or_else(
                    || transport.identifier.clone(),
                    |service| service.address.clone(),
                );
            let device = PhoneDevice {
                platform: Default::default(),
                capabilities: Default::default(),
                id: target.selection_id(),
                identity,
                name: transport.name,
                availability: transport.availability,
                endpoint: DeviceEndpoint {
                    transport: transport.transport,
                    address,
                    identifier: transport.identifier,
                },
            };
            if seen.insert(device.id.clone()) {
                devices.push(device);
            }
        }
        if cancellation.is_cancelled() {
            return Err("기기 검색을 취소했습니다.".into());
        }
        if self.store.load()? != bookmarks {
            self.store.save(&bookmarks)?;
        }
        Ok(devices)
    }
}
