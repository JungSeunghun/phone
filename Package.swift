// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PhoneMirror",
    platforms: [.macOS(.v14)],
    products: [.library(name: "PhoneMirrorCore", targets: ["PhoneMirrorCore"]), .executable(name: "PhoneMirror", targets: ["PhoneMirrorApp"])],
    targets: [
        .target(name: "PhoneMirrorCore", path: "Sources/PhoneMirrorCore"),
        .executableTarget(name: "PhoneMirrorApp", dependencies: ["PhoneMirrorCore"], path: "Sources/PhoneMirrorApp"),
        .testTarget(name: "PhoneMirrorCoreTests", dependencies: ["PhoneMirrorCore"]),
        .testTarget(name: "PhoneMirrorAppTests", dependencies: ["PhoneMirrorApp", "PhoneMirrorCore"])
    ]
)
