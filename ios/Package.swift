// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PhoneMirrorSenderCore", platforms: [.macOS(.v14), .iOS(.v16)],
  products: [.library(name: "PhoneMirrorSenderCore", targets: ["PhoneMirrorSenderCore"])],
  dependencies: [.package(path: "../localization")],
  targets: [
    .executableTarget(name: "KeyboardInputMock", dependencies: ["PhoneMirrorSenderCore"], path: "KeyboardVerification"),
    .executableTarget(
      name: "SenderMock", dependencies: ["PhoneMirrorSenderCore"], path: "Verification"),
    .target(name: "PhoneMirrorSenderCore", dependencies: [.product(name: "PhoneMirrorLocalization", package: "localization")], path: "Shared"),
    .testTarget(
      name: "PhoneMirrorSenderCoreTests", dependencies: ["PhoneMirrorSenderCore"],
      path: "Tests/PhoneMirrorSenderCoreTests"),
  ])
