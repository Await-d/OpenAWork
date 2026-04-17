using System.Text.Json;

namespace OpenAWork.Gateway.Contracts.Settings;

public sealed record WorkersResponse(IReadOnlyList<JsonElement> Workers);
