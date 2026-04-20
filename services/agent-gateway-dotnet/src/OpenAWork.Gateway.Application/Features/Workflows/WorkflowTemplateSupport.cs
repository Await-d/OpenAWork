using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using OpenAWork.Gateway.Contracts.Workflows;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Application.Features.Workflows;

internal static class WorkflowTemplateSupport
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly string[] FixedRequiredRoles = ["leader", "planner", "researcher", "executor", "reviewer"];

    private static readonly IReadOnlyDictionary<string, string> FixedRoleAgentBindings = new Dictionary<string, string>
    {
        ["leader"] = "zeus",
        ["planner"] = "prometheus",
        ["researcher"] = "librarian",
        ["executor"] = "hephaestus",
        ["reviewer"] = "momus",
    };

    public static WorkflowTemplateResponse Map(WorkflowTemplateRecord record)
    {
        return new WorkflowTemplateResponse(
            Id: record.Id,
            Name: record.Name,
            Description: record.Description,
            Category: record.Category,
            Metadata: ParseOrThrow(record.MetadataJson, "{}"),
            Nodes: ParseOrThrow(record.NodesJson, "[]"),
            Edges: ParseOrThrow(record.EdgesJson, "[]"),
            CreatedAt: ToTsIsoString(record.CreatedAtUtc),
            UpdatedAt: ToTsIsoString(record.UpdatedAtUtc));
    }

    public static JsonElement NormalizeMetadata(string category, JsonElement metadata)
    {
        var metadataObject = metadata.ValueKind == JsonValueKind.Object
            ? JsonNode.Parse(metadata.GetRawText())?.AsObject() ?? new JsonObject()
            : new JsonObject();

        if (!string.Equals(category, "team-playbook", StringComparison.Ordinal))
        {
            return ToElement(metadataObject);
        }

        var teamTemplate = metadataObject["teamTemplate"] as JsonObject ?? new JsonObject();
        var defaultBindings = BuildFixedDefaultBindings();
        if (teamTemplate["defaultBindings"] is JsonObject existingBindings)
        {
            foreach (var role in FixedRequiredRoles)
            {
                if (existingBindings.TryGetPropertyValue(role, out var bindingValue))
                {
                    defaultBindings[role] = bindingValue?.DeepClone();
                }
            }
        }

        teamTemplate["defaultBindings"] = defaultBindings;
        teamTemplate["requiredRoles"] = new JsonArray(FixedRequiredRoles.Select((role) => JsonValue.Create(role)).ToArray());
        metadataObject["teamTemplate"] = teamTemplate;

        return ToElement(metadataObject);
    }

    public static string Serialize(JsonElement element) => element.GetRawText();

    private static JsonObject BuildFixedDefaultBindings()
    {
        var bindings = new JsonObject();
        foreach (var role in FixedRequiredRoles)
        {
            bindings[role] = new JsonObject
            {
                ["agentId"] = FixedRoleAgentBindings[role],
            };
        }

        return bindings;
    }

    private static JsonElement ParseOrThrow(string? raw, string fallback)
    {
        using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? fallback : raw);
        return document.RootElement.Clone();
    }

    private static JsonElement ToElement(JsonNode node)
        => JsonSerializer.SerializeToElement(node, JsonOptions);

    private static string ToTsIsoString(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
