fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let target = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let architecture = if target == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        for name in ["ios_capture", "keyboard_shortcuts"] {
            let source = if name == "keyboard_shortcuts" {
                "native/phone_keyboard_shortcuts.m"
            } else {
                "native/ios_capture.m"
            };
            println!("cargo:rerun-if-changed={source}");
            let object = output.join(format!("{name}.o"));
            let library = output.join(format!("libphone_{name}.a"));
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
                    source,
                    "-o",
                ])
                .arg(&object)
                .status()
                .expect("macOS capture requires Xcode command line tools");
            assert!(
                compiled.success(),
                "macOS native adapter compilation failed"
            );
            assert!(std::process::Command::new("xcrun")
                .args(["ar", "rcs"])
                .arg(&library)
                .arg(&object)
                .status()
                .unwrap()
                .success());
            println!("cargo:rustc-link-search=native={}", output.display());
            println!("cargo:rustc-link-lib=static=phone_{name}");
        }
        for framework in [
            "Foundation",
            "AppKit",
            "Carbon",
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
