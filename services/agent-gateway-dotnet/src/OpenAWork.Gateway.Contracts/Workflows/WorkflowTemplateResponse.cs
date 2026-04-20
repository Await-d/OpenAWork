using System.Text.Json;

namespace OpenAWork.Gateway.Contracts.Workflows;

public sealed record WorkflowTemplateResponse(
    string Id,
    string Name,
    string? Description,
    string Category,
    JsonElement Metadata,
    JsonElement Nodes,
    JsonElement Edges,
    string CreatedAt,
    string UpdatedAt);
