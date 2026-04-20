namespace OpenAWork.Gateway.Contracts.Tools;

public sealed record ToolDefinitionsResponse(IReadOnlyList<ToolDefinitionItemResponse> Tools);
