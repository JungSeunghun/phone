// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PhoneMirror",
    platforms: [.macOS(.v14)],
    products: [.library(name: "PhoneMirrorCore", targets: ["PhoneMirrorCore"]), .executable(name: "PhoneMirror", targets: ["PhoneMirrorApp"])],
    dependencies: [.package(path: "localization")],
    targets: [
        .target(name: "PhoneMirrorCore", path: "Sources/PhoneMirrorCore"),
        .executableTarget(name: "PhoneMirrorApp", dependencies: ["PhoneMirrorCore", .product(name: "PhoneMirrorLocalization", package: "localization")], path: "Sources/PhoneMirrorApp"),
        .testTarget(name: "PhoneMirrorCoreTests", dependencies: ["PhoneMirrorCore", .product(name: "PhoneMirrorLocalization", package: "localization")]),
        .testTarget(name: "PhoneMirrorAppTests", dependencies: ["PhoneMirrorApp", "PhoneMirrorCore"])
    ]
)
