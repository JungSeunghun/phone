use phone_mirror_desktop::{domain::MirrorSettings, infrastructure::adaptive_video_bit_rate};
#[test]
fn validates_quality_bounds_and_maps_actual_encoder_bandwidth() {
    for (dimension, fps, expected) in [
        (720, 15, 1_500_000),
        (1280, 30, 4_000_000),
        (1920, 60, 8_000_000),
        (3840, 60, 8_000_000),
    ] {
        let settings = MirrorSettings {
            video_max_dimension: dimension,
            video_max_frame_rate: fps,
            keep_screen_awake: true,
        };
        assert_eq!(adaptive_video_bit_rate(&settings).unwrap(), expected);
    }
    assert!(adaptive_video_bit_rate(&MirrorSettings {
        video_max_dimension: 0,
        video_max_frame_rate: 60,
        keep_screen_awake: true
    })
    .is_err());
}
#[test]
fn server_receives_one_effective_bit_rate_not_an_overridden_default() {
    use phone_mirror_desktop::{
        domain::ConnectionTransport, infrastructure::server_arguments_for_transport,
    };
    let arguments = server_arguments_for_transport(
        "device",
        "remote",
        "00000001",
        &MirrorSettings {
            video_max_dimension: 720,
            video_max_frame_rate: 15,
            keep_screen_awake: false,
        },
        false,
        ConnectionTransport::Wifi,
    );
    assert_eq!(
        arguments
            .iter()
            .filter(|v| v.starts_with("video_bit_rate="))
            .collect::<Vec<_>>(),
        vec![&"video_bit_rate=1500000".to_owned()]
    );
}
#[test]
fn usb_retains_its_original_bit_rate_even_with_low_frame_rate() {
    use phone_mirror_desktop::{
        domain::ConnectionTransport, infrastructure::server_arguments_for_transport,
    };
    let settings = MirrorSettings {
        video_max_dimension: 720,
        video_max_frame_rate: 15,
        keep_screen_awake: false,
    };
    let arguments = server_arguments_for_transport(
        "device",
        "remote",
        "00000001",
        &settings,
        false,
        ConnectionTransport::Usb,
    );
    assert!(arguments.contains(&"video_bit_rate=8000000".into()));
}
