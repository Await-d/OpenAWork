namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record VersionResponse(
    string CurrentVersion,
    string? LatestVersion,
    bool UpdateAvailable,
    string? CheckError,
    string CheckedAt);
