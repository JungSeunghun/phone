use super::{AdbCommandExecutor, CommandResult};
use crate::{
    connection_diagnostics::*,
    domain::*,
    ios_usb::{AppleUsbMuxPort, UsbMuxPort},
};
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;
pub struct ProcessConnectionDiagnosticPort {
    executor: Arc<dyn AdbCommandExecutor>,
    server_path: PathBuf,
    ios_wifi: Arc<crate::ios_receiver::IosMediaReceiverService>,
    ios_usb: Arc<crate::ios_usb::IosUsbReceiverService>,
}
impl ProcessConnectionDiagnosticPort {
    pub fn new(
        executor: Arc<dyn AdbCommandExecutor>,
        server_path: PathBuf,
        ios_wifi: Arc<crate::ios_receiver::IosMediaReceiverService>,
        ios_usb: Arc<crate::ios_usb::IosUsbReceiverService>,
    ) -> Self {
        Self {
            executor,
            server_path,
            ios_wifi,
            ios_usb,
        }
    }
    async fn adb(
        &self,
        args: Vec<String>,
        cancellation: CancellationToken,
    ) -> Option<CommandResult> {
        self.executor
            .execute(args, None, cancellation)
            .await
            .ok()
            .filter(|result| result.success)
    }
}
#[async_trait]
impl ConnectionDiagnosticPort for ProcessConnectionDiagnosticPort {
    async fn inspect(
        &self,
        probe: DiagnosticProbe,
        request: &DiagnosticRequest,
        cancellation: CancellationToken,
    ) -> ProbeObservation {
        use ProbeObservation::*;
        if cancellation.is_cancelled() {
            return Unavailable;
        }
        match probe {
            DiagnosticProbe::Adb => {
                if self.executor.executable().is_err() {
                    return Missing;
                }
                if self
                    .adb(vec!["version".into()], cancellation)
                    .await
                    .is_some()
                {
                    Passed
                } else {
                    Unavailable
                }
            }
            DiagnosticProbe::AndroidDevice => {
                let Some(result) = self
                    .adb(vec!["devices".into(), "-l".into()], cancellation)
                    .await
                else {
                    return Unavailable;
                };
                let devices = parse_transports(&result.output);
                let matching: Vec<_> = devices
                    .iter()
                    .filter(|device| {
                        device.transport == request.transport
                            && request
                                .identifier
                                .as_ref()
                                .is_none_or(|id| id == &device.identifier)
                    })
                    .collect();
                if matching.is_empty() {
                    Missing
                } else if matching
                    .iter()
                    .any(|device| device.availability == DeviceAvailability::Unauthorized)
                {
                    Unauthorized
                } else if matching
                    .iter()
                    .any(|device| device.availability == DeviceAvailability::Offline)
                {
                    Offline
                } else {
                    Passed
                }
            }
            DiagnosticProbe::VideoServer => {
                if std::fs::metadata(&self.server_path)
                    .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
                {
                    Passed
                } else {
                    Missing
                }
            }
            DiagnosticProbe::WirelessDiscovery => {
                let Some(result) = self
                    .adb(vec!["mdns".into(), "services".into()], cancellation)
                    .await
                else {
                    return Unavailable;
                };
                let services = parse_services(&result.output);
                if services.is_empty() {
                    Missing
                } else {
                    Passed
                }
            }
            DiagnosticProbe::ConnectionPort => {
                let Some(address) = request
                    .address
                    .as_ref()
                    .and_then(|address| WirelessEndpoint::parse(address).ok())
                else {
                    return Unavailable;
                };
                tokio::select! {biased;_=cancellation.cancelled()=>Unavailable,result=tokio::net::TcpStream::connect(&address.address)=>if result.is_ok(){Passed}else{Unreachable}}
            }
            DiagnosticProbe::NativeIosDevices => {
                let discovered =
                    tokio::task::spawn_blocking(crate::ios_capture::discover_ios_devices).await;
                match discovered {
                    Ok(Ok(devices)) => {
                        let matching: Vec<_> = devices
                            .iter()
                            .filter(|device| {
                                request
                                    .identifier
                                    .as_ref()
                                    .is_none_or(|id| id == &device.endpoint.identifier)
                            })
                            .collect();
                        if matching.is_empty() {
                            Missing
                        } else if matching
                            .iter()
                            .any(|device| device.availability == DeviceAvailability::Unauthorized)
                        {
                            Unauthorized
                        } else {
                            Passed
                        }
                    }
                    _ => Unavailable,
                }
            }
            DiagnosticProbe::AppleUsbDevices => match AppleUsbMuxPort::default().discover().await {
                Ok(devices) => match devices.len() {
                    0 => Missing,
                    1 => {
                        if request
                            .identifier
                            .as_ref()
                            .is_some_and(|id| id != &devices[0].identifier)
                        {
                            Missing
                        } else {
                            Passed
                        }
                    }
                    _ => MultipleDevices,
                },
                Err(_) => Unavailable,
            },
            DiagnosticProbe::IosWifiReceiver => self.ios_wifi.diagnostic_observation().await,
            DiagnosticProbe::IosUsbReceiver => self.ios_usb.diagnostic_observation().await,
            DiagnosticProbe::LocalNetwork => match if_addrs::get_if_addrs() {
                Ok(interfaces) => {
                    if interfaces.iter().any(|interface| {
                        !interface.ip().is_loopback() && !interface.ip().is_unspecified()
                    }) {
                        Passed
                    } else {
                        Missing
                    }
                }
                Err(_) => Unavailable,
            },
        }
    }
}
