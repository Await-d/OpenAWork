namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record CompactionSettingsResponse(
    bool Auto,
    bool Prune,
    int RecentMessagesKept,
    int? Reserved);
