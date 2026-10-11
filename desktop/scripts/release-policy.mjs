export const releaseTargets = Object.freeze([
  {
    id: "macos-arm64",
    target: "aarch64-apple-darwin",
    os: "macos-latest",
    bundle: "dmg",
    extension: ".dmg",
  },
  {
    id: "macos-x64",
    target: "x86_64-apple-darwin",
    os: "macos-latest",
    bundle: "dmg",
    extension: ".dmg",
  },
  {
    id: "windows-x64",
    target: "x86_64-pc-windows-msvc",
    os: "windows-latest",
    bundle: "nsis",
    extension: ".exe",
  },
]);
export function releaseVersion(tag) {
  if (typeof tag !== "string" || tag.length > 128)
    throw new Error("Invalid desktop release tag.");
  const match =
    /^desktop-v((0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.([1-9][0-9]*))?)$/.exec(
      tag,
    );
  if (
    !match ||
    match[0] !== tag ||
    [match[2], match[3], match[4]].some((value) => Number(value) > 65535) ||
    (match[6] && Number(match[6]) > 9999)
  )
    throw new Error("Invalid desktop release tag.");
  return { tag, version: match[1], prerelease: !!match[5] };
}
export function validateVersions(tag, versions) {
  const release = releaseVersion(tag);
  for (const field of [
    "package",
    "packageLock",
    "packageLockRoot",
    "tauri",
    "cargo",
    "cargoLock",
  ])
    if (versions?.[field] !== release.version)
      throw new Error(`Release version mismatch: ${field}.`);
  return release;
}
export function releaseTarget(identifier) {
  const target = releaseTargets.find((target) => target.id === identifier);
  if (!target) throw new Error("Unsupported release target.");
  return target;
}
export function artifactName(version, targetIdentifier) {
  releaseVersion(`desktop-v${version}`);
  const target = releaseTarget(targetIdentifier);
  return `Phone-Mirror-Desktop_${version}_${target.id}${target.id === "windows-x64" ? "-setup" : ""}${target.extension}`;
}
export function signingConfiguration(targetIdentifier, mode, environment) {
  const target = releaseTarget(targetIdentifier);
  if (!["signed", "unsigned"].includes(mode))
    throw new Error("Invalid release signing mode.");
  if (mode === "unsigned")
    return target.bundle === "dmg"
      ? { bundle: { macOS: { signingIdentity: "-" } } }
      : {
          bundle: {
            windows: { signCommand: null, certificateThumbprint: null },
          },
        };
  const required =
    target.bundle === "dmg"
      ? [
          "APPLE_CERTIFICATE",
          "APPLE_CERTIFICATE_PASSWORD",
          "APPLE_SIGNING_IDENTITY",
          "APPLE_API_ISSUER",
          "APPLE_API_KEY",
          "APPLE_API_PRIVATE_KEY_BASE64",
        ]
      : [
          "AZURE_CLIENT_ID",
          "AZURE_CLIENT_SECRET",
          "AZURE_TENANT_ID",
          "WINDOWS_SIGNING_ENDPOINT",
          "WINDOWS_SIGNING_ACCOUNT",
          "WINDOWS_SIGNING_PROFILE",
        ];
  for (const key of required)
    if (typeof environment[key] !== "string" || !environment[key].trim())
      throw new Error(`Missing signing configuration: ${key}.`);
  if (target.bundle === "dmg") {
    if (
      !environment.APPLE_SIGNING_IDENTITY.startsWith(
        "Developer ID Application:",
      )
    )
      throw new Error("A Developer ID Application identity is required.");
    return {
      bundle: {
        macOS: { signingIdentity: environment.APPLE_SIGNING_IDENTITY },
      },
    };
  }
  if (
    !/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net$/.test(
      environment.WINDOWS_SIGNING_ENDPOINT,
    ) ||
    ![
      environment.WINDOWS_SIGNING_ACCOUNT,
      environment.WINDOWS_SIGNING_PROFILE,
    ].every((value) => /^[A-Za-z0-9-]{1,100}$/.test(value))
  )
    throw new Error("Invalid Windows signing account configuration.");
  return {
    bundle: {
      windows: {
        signCommand: {
          cmd: "artifact-signing-cli",
          args: [
            "-e",
            environment.WINDOWS_SIGNING_ENDPOINT,
            "-a",
            environment.WINDOWS_SIGNING_ACCOUNT,
            "-c",
            environment.WINDOWS_SIGNING_PROFILE,
            "%1",
          ],
        },
        digestAlgorithm: "sha256",
      },
    },
  };
}
export function validateInventory(version, inventory) {
  if (!Array.isArray(inventory) || inventory.length !== releaseTargets.length)
    throw new Error("All three installers are required.");
  const seen = new Set();
  for (const item of inventory) {
    if (
      !item ||
      seen.has(item.target) ||
      item.name !== artifactName(version, item.target) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      item.size > 1024 ** 3 ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !["unsigned", "signed"].includes(item.signingMode)
    )
      throw new Error("Invalid or duplicated release artifact.");
    seen.add(item.target);
  }
  if (new Set(inventory.map((item) => item.signingMode)).size !== 1)
    throw new Error("Signing modes must match across all platforms.");
  return [...inventory].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
export function buildEnvironment(targetIdentifier, mode, environment) {
  const target = releaseTarget(targetIdentifier);
  if (!["signed", "unsigned"].includes(mode))
    throw new Error("Invalid release signing mode.");
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (
      (key.startsWith("APPLE_") &&
        (mode === "unsigned" || target.bundle !== "dmg")) ||
      ((key.startsWith("AZURE_") || key.startsWith("WINDOWS_SIGNING_")) &&
        (mode === "unsigned" || target.bundle !== "nsis")) ||
      key === "APPLE_API_PRIVATE_KEY_BASE64"
    )
      delete result[key];
  }
  return result;
}
