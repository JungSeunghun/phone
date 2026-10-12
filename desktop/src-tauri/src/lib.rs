pub mod application;
#[cfg(feature = "desktop")]
mod desktop;
pub mod domain;
pub mod infrastructure;
#[cfg(feature = "desktop")]
pub use desktop::run;

pub mod media;

pub mod interaction;

pub mod window_presentation;

#[cfg(feature = "desktop")]
mod window_presentation_adapter;

pub mod recording;

pub mod ios;
pub mod ios_capture;
pub mod ios_keyboard;

pub mod ios_receiver;
pub mod ios_wifi;

pub mod recording_audio;

mod recording_muxer;

pub mod ios_usb;

pub mod android_qr;

pub mod connection_diagnostics;

pub mod application_update;
#[cfg(feature = "desktop")]
mod application_update_adapter;

pub mod diagnostic_summary;
