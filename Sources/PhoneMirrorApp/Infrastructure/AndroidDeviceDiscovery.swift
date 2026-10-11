import Foundation
import PhoneMirrorCore

/// Resolves authenticated transports to a stable serial and rediscovers bookmarked TLS services.
/// IP addresses are never identities; a reused address cannot silently become the reconnect target.
actor AndroidDeviceDiscovery: DeviceDiscovery {
    private let executor: any ADBCommandExecuting
    private let bookmarkStore: any WirelessDeviceStore
    private var nextConnectTimes: [String: TimeInterval] = [:]
    // Only retain resolutions for transports still reported by ADB. A temporary
    // empty mDNS response is not evidence that an authenticated endpoint changed.
    private var resolvedServices: [String: WirelessService] = [:]
    private let timeProvider: any TimeProvider
    init(executor: any ADBCommandExecuting = ADBCommandExecutor(), bookmarkStore: any WirelessDeviceStore = UserDefaultsWirelessDeviceStore(), timeProvider: any TimeProvider = MonotonicTimeProvider()) {
        self.executor = executor; self.bookmarkStore = bookmarkStore; self.timeProvider = timeProvider
    }
    func discoverDevices(for platform: PhonePlatform) async throws -> [PhoneDevice] {
        guard platform == .android else { return [] }
        var list = try await executor.execute(["devices", "-l"], standardInput: nil)
        guard list.exitCode == 0 else { throw MediaError.failed("기기 검색 실패. ADB 연결을 확인하세요.") }
        let serviceResult = try? await executor.execute(["mdns", "services"], standardInput: nil)
        let services = (serviceResult?.exitCode == 0 ? ADBServiceParser.parse(serviceResult!.output) : []).sorted {
            if $0.instanceNumber != $1.instanceNumber { return $0.instanceNumber > $1.instanceNumber }; return $0.id < $1.id
        }
        var transports = AndroidDeviceParser.parseTransports(list.output)
        var bookmarks = bookmarkStore.load().filter(\.isValid)
        var connected = false
        for bookmark in bookmarks {
            guard let service = services.first(where: { $0.kind == .connection && bookmark.matchesServiceName($0.name) }),
                  !transports.contains(where: { $0.availability == .ready && service.matchesIdentifier($0.identifier) }),
                  timeProvider.now >= (nextConnectTimes[bookmark.serviceName] ?? 0) else { continue }
            nextConnectTimes[bookmark.serviceName] = timeProvider.now + 4
            do { try await ADBWirelessConnectionService(executor: executor).connect(address: service.endpoint.address); connected = true }
            catch is CancellationError { throw CancellationError() } catch { /* A missing wireless device must not hide USB devices. */ }
        }
        if connected {
            list = try await executor.execute(["devices", "-l"], standardInput: nil)
            if list.exitCode == 0 { transports = AndroidDeviceParser.parseTransports(list.output) }
        }
        let currentIdentifiers = Set(transports.map(\.identifier))
        resolvedServices = resolvedServices.filter { currentIdentifiers.contains($0.key) }
        for transport in transports {
            if let service = services.first(where: { $0.kind == .connection && $0.matchesIdentifier(transport.identifier) }) {
                resolvedServices[transport.identifier] = service
            }
        }
        var devices: [PhoneDevice] = [], seen = Set<String>()
        let orderedTransports = transports.sorted { left, right in
            if left.transport != right.transport { return left.transport == .usb }
            let leftService = resolvedServices[left.identifier]
            let rightService = resolvedServices[right.identifier]
            if (leftService?.instanceNumber ?? 0) != (rightService?.instanceNumber ?? 0) { return (leftService?.instanceNumber ?? 0) > (rightService?.instanceNumber ?? 0) }
            let leftAlias = left.identifier.contains("._adb-tls-connect._tcp"), rightAlias = right.identifier.contains("._adb-tls-connect._tcp")
            if leftAlias != rightAlias { return leftAlias }; return left.identifier < right.identifier
        }
        for transport in orderedTransports {
            var identity = DeviceIdentity(platform: .android, id: transport.identifier)
            if transport.transport == .wifi {
                guard transport.availability == .ready else { continue }
                let serial = try await executor.execute(["-s", transport.identifier, "shell", "getprop", "ro.serialno"], standardInput: nil)
                identity = DeviceIdentity(platform: .android, id: serial.output.trimmingCharacters(in: .whitespacesAndNewlines))
                guard serial.exitCode == 0, identity.isValid, identity.id.lowercased() != "unknown", WirelessEndpoint(address: identity.id) == nil else { continue }
                if seen.contains(ConnectionTarget(identity: identity, transport: .wifi).selectionID) { continue }
                let guid = try await executor.execute(["-s", transport.identifier, "shell", "getprop", "persist.adb.wifi.guid"], standardInput: nil)
                let serviceName = guid.exitCode == 0 && !guid.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "adb-" + guid.output.trimmingCharacters(in: .whitespacesAndNewlines)
                    : resolvedServices[transport.identifier]?.name
                if let serviceName {
                    let bookmark = WirelessDeviceBookmark(identity: identity, name: transport.name, serviceName: serviceName)
                    if bookmark.isValid {
                        // Do not overwrite a known phone with a different serial at the same service name.
                        if let known = bookmarks.first(where: {  $0.matchesServiceName(serviceName) }), known.identity != identity { continue }
                        bookmarks.removeAll { $0.identity == identity }; bookmarks.append(bookmark)
                    }
                }
            }
            let resolvedAddress = resolvedServices[transport.identifier]?.endpoint.address ?? transport.identifier
            let device = PhoneDevice(identity: identity, name: transport.name, availability: transport.availability, endpoint: DeviceEndpoint(transport: transport.transport, address: resolvedAddress, identifier: transport.identifier))
            if seen.insert(device.id).inserted { devices.append(device) }
        }
        if bookmarks != bookmarkStore.load() { try bookmarkStore.save(bookmarks) }
        return devices
    }
}
