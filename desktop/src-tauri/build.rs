fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/ios_capture.m");
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let object = output.join("ios_capture.o");
        let library = output.join("libphone_ios_capture.a");
        let target = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let architecture = if target == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        let compiled = std::process::Command::new("xcrun")
            .args([
                "clang",
                "-fobjc-arc",
                "-fblocks",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Wno-deprecated-declarations",
                "-mmacosx-version-min=14.0",
                "-arch",
                architecture,
                "-c",
                "native/ios_capture.m",
                "-o",
            ])
            .arg(&object)
            .status()
            .expect("macOS capture requires Xcode command line tools");
        assert!(compiled.success(), "iPhone capture compilation failed");
        assert!(std::process::Command::new("xcrun")
            .args(["ar", "rcs"])
            .arg(&library)
            .arg(&object)
            .status()
            .unwrap()
            .success());
        println!("cargo:rustc-link-search=native={}", output.display());
        println!("cargo:rustc-link-lib=static=phone_ios_capture");
        for framework in [
            "Foundation",
            "AVFoundation",
            "CoreMediaIO",
            "CoreMedia",
            "CoreVideo",
            "VideoToolbox",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
