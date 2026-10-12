// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "PhoneMirrorLocalization",
    products: [.library(name: "PhoneMirrorLocalization", targets: ["PhoneMirrorLocalization"])],
    targets: [.target(name: "PhoneMirrorLocalization", path: ".", resources: [.copy("EnglishMessages.json")])]
)
