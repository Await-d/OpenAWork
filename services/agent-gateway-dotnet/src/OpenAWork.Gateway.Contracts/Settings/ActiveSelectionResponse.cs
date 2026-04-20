namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record ActiveSelectionResponse(
    ActiveSelectionItemResponse Chat,
    ActiveSelectionItemResponse Fast,
    ActiveSelectionItemResponse? Compaction = null);
