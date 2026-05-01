using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Persistence.EFCore;

namespace OpenAWork.Gateway.Application.Features.Sessions;

internal static class SessionMetadataSupport
{
    private const string ParentImmutableError = "Session parent cannot be changed after binding";
    private const string WorkspaceImmutableError = "Session workspace cannot be moved after binding";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static JsonObject ParseAndValidateMetadataPatch(JsonElement metadataElement, string errorMessage)
    {
        var issues = new List<object>();
        if (metadataElement.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "metadata" }, "object", DescribeJsonKind(metadataElement.ValueKind)));
            throw new SessionRequestValidationException(400, errorMessage, issues);
        }

        ValidateMetadataObject(metadataElement, new[] { "metadata" }, issues);
        if (issues.Count > 0)
        {
            throw new SessionRequestValidationException(400, errorMessage, issues);
        }

        return JsonNode.Parse(metadataElement.GetRawText())?.AsObject() ?? new JsonObject();
    }

    public static JsonObject ParsePersistedMetadata(string metadataJson)
    {
        try
        {
            var node = JsonNode.Parse(metadataJson);
            return node as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    public static string SanitizePersistedMetadataJson(string metadataJson, IReadOnlyList<string> workspaceRoots)
    {
        try
        {
            var metadata = ParsePersistedMetadata(metadataJson);
            var workingDirectory = ExtractWorkingDirectory(metadata);
            if (workingDirectory is null)
            {
                return metadataJson;
            }

            var safeWorkingDirectory = SessionWorkspaceRootSupport.NormalizeWorkspacePath(workingDirectory, workspaceRoots);
            if (safeWorkingDirectory == workingDirectory)
            {
                return metadataJson;
            }

            if (safeWorkingDirectory is null)
            {
                metadata.Remove("workingDirectory");
            }
            else
            {
                metadata["workingDirectory"] = safeWorkingDirectory;
            }

            return metadata.ToJsonString(JsonOptions);
        }
        catch (JsonException)
        {
            return metadataJson;
        }
    }

    public static string NormalizeNewMetadata(
        JsonObject metadata,
        string? workingDirectory,
        IReadOnlyList<string> workspaceRoots)
    {
        if (workingDirectory is not null)
        {
            metadata["workingDirectory"] = workingDirectory;
        }

        var normalized = NormalizeIncomingMetadata(metadata, workspaceRoots);
        if (normalized.WorkingDirectory is null && (workingDirectory is not null || metadata["workingDirectory"] is not null))
        {
            throw new SessionRequestValidationException(403, "Forbidden");
        }

        return normalized.Metadata.ToJsonString(JsonOptions);
    }

    public static string MergeMetadataForUpdate(string currentMetadataJson, JsonObject patchMetadata, IReadOnlyList<string> workspaceRoots)
    {
        var currentMetadata = ParsePersistedMetadata(SanitizePersistedMetadataJson(currentMetadataJson, workspaceRoots));
        var requestedWorkingDirectory = ExtractWorkingDirectory(patchMetadata);
        var currentParentSessionId = ExtractParentSessionId(currentMetadata);
        var requestedParentSessionId = ExtractParentSessionId(patchMetadata);

        var normalizedRequestedWorkingDirectory = requestedWorkingDirectory is null
            ? null
            : SessionWorkspaceRootSupport.NormalizeWorkspacePath(requestedWorkingDirectory, workspaceRoots);
        if (requestedWorkingDirectory is not null && normalizedRequestedWorkingDirectory is null)
        {
            throw new SessionRequestValidationException(403, "Forbidden");
        }

        if (IsWorkspaceRebindingAttempt(currentMetadata, normalizedRequestedWorkingDirectory))
        {
            throw new SessionRequestValidationException(409, WorkspaceImmutableError);
        }

        if (currentParentSessionId is not null && requestedParentSessionId is not null && currentParentSessionId != requestedParentSessionId)
        {
            throw new SessionRequestValidationException(409, ParentImmutableError);
        }

        foreach (var property in patchMetadata)
        {
            currentMetadata[property.Key] = property.Value?.DeepClone();
        }

        var normalized = NormalizeIncomingMetadata(currentMetadata, workspaceRoots);
        if (normalized.WorkingDirectory is null && requestedWorkingDirectory is not null)
        {
            throw new SessionRequestValidationException(403, "Forbidden");
        }

        return normalized.Metadata.ToJsonString(JsonOptions);
    }

    public static string? ExtractParentSessionId(JsonObject metadata)
        => metadata["parentSessionId"] is JsonValue value && value.TryGetValue<string>(out var parentSessionId)
            ? parentSessionId
            : null;

    public static async Task ValidateParentSessionBindingAsync(
        GatewayDbContext dbContext,
        string userId,
        string? requestedParentSessionId,
        string? sessionId,
        string? currentParentSessionId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(requestedParentSessionId))
        {
            return;
        }

        if (sessionId is not null && requestedParentSessionId == sessionId)
        {
            throw new SessionRequestValidationException(400, "Session cannot be its own parent");
        }

        if (currentParentSessionId is not null && currentParentSessionId != requestedParentSessionId)
        {
            throw new SessionRequestValidationException(409, ParentImmutableError);
        }

        var exists = await dbContext.Sessions.AnyAsync(
            (session) => session.Id == requestedParentSessionId && session.UserId == userId,
            cancellationToken);
        if (!exists)
        {
            throw new SessionRequestValidationException(404, "Parent session not found");
        }
    }

    public static string? ExtractWorkingDirectory(JsonObject metadata)
    {
        return metadata["workingDirectory"] is JsonValue value && value.TryGetValue<string>(out var workingDirectory)
            ? workingDirectory
            : null;
    }

    private static (JsonObject Metadata, string? WorkingDirectory) NormalizeIncomingMetadata(JsonObject metadata, IReadOnlyList<string> workspaceRoots)
    {
        var workingDirectory = ExtractWorkingDirectory(metadata);
        if (workingDirectory is null)
        {
            return (metadata, null);
        }

        var safeWorkingDirectory = SessionWorkspaceRootSupport.NormalizeWorkspacePath(workingDirectory, workspaceRoots);
        if (safeWorkingDirectory is null)
        {
            return (metadata, null);
        }

        metadata["workingDirectory"] = safeWorkingDirectory;
        return (metadata, safeWorkingDirectory);
    }

    private static bool IsWorkspaceRebindingAttempt(JsonObject currentMetadata, string? nextWorkingDirectory)
    {
        var currentWorkingDirectory = ExtractWorkingDirectory(currentMetadata);
        if (currentWorkingDirectory is null || nextWorkingDirectory is null)
        {
            return false;
        }

        return currentWorkingDirectory != nextWorkingDirectory;
    }
    private static void ValidateMetadataObject(JsonElement metadataElement, string[] pathPrefix, List<object> issues)
    {
        foreach (var property in metadataElement.EnumerateObject())
        {
            switch (property.Name)
            {
                case "agentId":
                    ValidateString(property.Value, BuildPath(pathPrefix, property.Name), issues, 1, 120);
                    break;
                case "dialogueMode":
                    ValidateEnumString(property.Value, BuildPath(pathPrefix, property.Name), issues, ["clarify", "coding", "programmer"]);
                    break;
                case "editSourceMessageId":
                case "modelId":
                case "parentSessionId":
                case "providerId":
                case "teamWorkspaceId":
                    ValidateString(property.Value, BuildPath(pathPrefix, property.Name), issues, 1, 200);
                    break;
                case "workingDirectory":
                    ValidateString(property.Value, BuildPath(pathPrefix, property.Name), issues, 1, int.MaxValue);
                    break;
                case "planMode":
                case "thinkingEnabled":
                case "webSearchEnabled":
                case "yoloMode":
                    ValidateBoolean(property.Value, BuildPath(pathPrefix, property.Name), issues);
                    break;
                case "reasoningEffort":
                    ValidateEnumString(property.Value, BuildPath(pathPrefix, property.Name), issues, ["minimal", "low", "medium", "high", "xhigh"]);
                    break;
                case "upstreamRetryMaxRetries":
                    ValidateInteger(property.Value, BuildPath(pathPrefix, property.Name), issues, 0, 3);
                    break;
                case "teamDefinition":
                    ValidateTeamDefinition(property.Value, BuildPath(pathPrefix, property.Name), issues);
                    break;
                default:
                    issues.Add(new { code = "unrecognized_keys", path = pathPrefix, keys = new[] { property.Name }, message = "Unrecognized key(s) in object" });
                    break;
            }
        }
    }

    private static void ValidateTeamDefinition(JsonElement element, string[] pathPrefix, List<object> issues)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(pathPrefix, "object", DescribeJsonKind(element.ValueKind)));
            return;
        }

        if (!element.TryGetProperty("requiredRoleBindings", out _))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, "requiredRoleBindings"), "array", "undefined"));
        }

        if (!element.TryGetProperty("source", out _))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, "source"), "object", "undefined"));
        }

        foreach (var property in element.EnumerateObject())
        {
            switch (property.Name)
            {
                case "createdAt":
                    ValidateString(property.Value, BuildPath(pathPrefix, property.Name), issues, 1, int.MaxValue);
                    break;
                case "defaultProvider":
                    ValidateNullableString(property.Value, BuildPath(pathPrefix, property.Name), issues, 1, 200);
                    break;
                case "optionalMembers":
                    ValidateOptionalMembers(property.Value, BuildPath(pathPrefix, property.Name), issues);
                    break;
                case "requiredRoleBindings":
                    ValidateRequiredRoleBindings(property.Value, BuildPath(pathPrefix, property.Name), issues);
                    break;
                case "source":
                    ValidateTeamSource(property.Value, BuildPath(pathPrefix, property.Name), issues);
                    break;
                default:
                    issues.Add(new { code = "unrecognized_keys", path = pathPrefix, keys = new[] { property.Name }, message = "Unrecognized key(s) in object" });
                    break;
            }
        }
    }

    private static void ValidateOptionalMembers(JsonElement element, string[] pathPrefix, List<object> issues)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(pathPrefix, "array", DescribeJsonKind(element.ValueKind)));
            return;
        }

        var index = 0;
        foreach (var item in element.EnumerateArray())
        {
            var itemPath = BuildPath(pathPrefix, index.ToString(CultureInfo.InvariantCulture));
            if (item.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(itemPath, "object", DescribeJsonKind(item.ValueKind)));
                index += 1;
                continue;
            }

            ValidateObjectKeys(item, itemPath, issues, ["agentId", "agentLabel", "canonicalRole"]);
            ValidateStringProperty(item, "agentId", itemPath, issues, 1, 200);
            ValidateStringProperty(item, "agentLabel", itemPath, issues, 1, 200);
            if (item.TryGetProperty("canonicalRole", out var canonicalRole))
            {
                ValidateNullableString(canonicalRole, BuildPath(itemPath, "canonicalRole"), issues, 1, 120);
            }

            index += 1;
        }
    }

    private static void ValidateRequiredRoleBindings(JsonElement element, string[] pathPrefix, List<object> issues)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(pathPrefix, "array", DescribeJsonKind(element.ValueKind)));
            return;
        }

        var index = 0;
        foreach (var item in element.EnumerateArray())
        {
            var itemPath = BuildPath(pathPrefix, index.ToString(CultureInfo.InvariantCulture));
            if (item.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(itemPath, "object", DescribeJsonKind(item.ValueKind)));
                index += 1;
                continue;
            }

            ValidateObjectKeys(item, itemPath, issues, ["agentId", "agentLabel", "modelId", "providerId", "role", "variant"]);
            ValidateStringProperty(item, "agentId", itemPath, issues, 1, 200);
            ValidateStringProperty(item, "agentLabel", itemPath, issues, 1, 200);
            ValidateEnumProperty(item, "role", itemPath, issues, ["leader", "planner", "researcher", "executor", "reviewer"]);
            ValidateOptionalStringProperty(item, "modelId", itemPath, issues, 1, 200);
            ValidateOptionalStringProperty(item, "providerId", itemPath, issues, 1, 200);
            ValidateOptionalStringProperty(item, "variant", itemPath, issues, 1, 80);

            index += 1;
        }
    }

    private static void ValidateTeamSource(JsonElement element, string[] pathPrefix, List<object> issues)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(pathPrefix, "object", DescribeJsonKind(element.ValueKind)));
            return;
        }

        ValidateObjectKeys(element, pathPrefix, issues, ["kind", "templateId", "templateName"]);
        ValidateEnumProperty(element, "kind", pathPrefix, issues, ["blank", "builtin-template", "saved-template"]);
        ValidateOptionalStringProperty(element, "templateId", pathPrefix, issues, 1, 200);
        ValidateOptionalStringProperty(element, "templateName", pathPrefix, issues, 1, 200);
    }

    private static void ValidateObjectKeys(JsonElement element, string[] pathPrefix, List<object> issues, IReadOnlyCollection<string> allowedKeys)
    {
        foreach (var property in element.EnumerateObject())
        {
            if (!allowedKeys.Contains(property.Name, StringComparer.Ordinal))
            {
                issues.Add(new { code = "unrecognized_keys", path = pathPrefix, keys = new[] { property.Name }, message = "Unrecognized key(s) in object" });
            }
        }
    }

    private static void ValidateStringProperty(JsonElement element, string propertyName, string[] pathPrefix, List<object> issues, int minLength, int maxLength)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", "undefined"));
            return;
        }

        ValidateString(property, BuildPath(pathPrefix, propertyName), issues, minLength, maxLength);
    }

    private static void ValidateOptionalStringProperty(JsonElement element, string propertyName, string[] pathPrefix, List<object> issues, int minLength, int maxLength)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return;
        }

        ValidateString(property, BuildPath(pathPrefix, propertyName), issues, minLength, maxLength);
    }

    private static void ValidateEnumProperty(JsonElement element, string propertyName, string[] pathPrefix, List<object> issues, IReadOnlyCollection<string> allowedValues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", "undefined"));
            return;
        }

        ValidateEnumString(property, BuildPath(pathPrefix, propertyName), issues, allowedValues);
    }

    private static void ValidateString(JsonElement element, string[] path, List<object> issues, int minLength, int maxLength)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(path, "string", DescribeJsonKind(element.ValueKind)));
            return;
        }

        var value = element.GetString() ?? string.Empty;
        if (value.Length < minLength)
        {
            issues.Add(new { code = "too_small", minimum = minLength, type = "string", inclusive = true, exact = false, path, message = $"String must contain at least {minLength} character(s)" });
            return;
        }

        if (maxLength != int.MaxValue && value.Length > maxLength)
        {
            issues.Add(new { code = "too_big", maximum = maxLength, type = "string", inclusive = true, exact = false, path, message = $"String must contain at most {maxLength} character(s)" });
        }
    }

    private static void ValidateNullableString(JsonElement element, string[] path, List<object> issues, int minLength, int maxLength)
    {
        if (element.ValueKind == JsonValueKind.Null)
        {
            return;
        }

        ValidateString(element, path, issues, minLength, maxLength);
    }

    private static void ValidateBoolean(JsonElement element, string[] path, List<object> issues)
    {
        if (element.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            return;
        }

        issues.Add(CreateInvalidTypeIssue(path, "boolean", DescribeJsonKind(element.ValueKind)));
    }

    private static void ValidateInteger(JsonElement element, string[] path, List<object> issues, int minValue, int maxValue)
    {
        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
        {
            issues.Add(CreateInvalidTypeIssue(path, "number", DescribeJsonKind(element.ValueKind)));
            return;
        }

        if (value < minValue)
        {
            issues.Add(new { code = "too_small", minimum = minValue, type = "number", inclusive = true, exact = false, path, message = $"Number must be greater than or equal to {minValue}" });
            return;
        }

        if (value > maxValue)
        {
            issues.Add(new { code = "too_big", maximum = maxValue, type = "number", inclusive = true, exact = false, path, message = $"Number must be less than or equal to {maxValue}" });
        }
    }

    private static void ValidateEnumString(JsonElement element, string[] path, List<object> issues, IReadOnlyCollection<string> allowedValues)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(path, "string", DescribeJsonKind(element.ValueKind)));
            return;
        }

        var value = element.GetString() ?? string.Empty;
        if (!allowedValues.Contains(value, StringComparer.Ordinal))
        {
            issues.Add(new { code = "invalid_enum_value", path, message = "Invalid enum value" });
        }
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received)
        => new { code = "invalid_type", path, expected, received, message = $"Expected {expected}" };

    private static string[] BuildPath(string[] pathPrefix, string propertyName)
        => [.. pathPrefix, propertyName];

    private static string DescribeJsonKind(JsonValueKind valueKind)
        => valueKind switch
        {
            JsonValueKind.Object => "object",
            JsonValueKind.Array => "array",
            JsonValueKind.String => "string",
            JsonValueKind.Number => "number",
            JsonValueKind.True or JsonValueKind.False => "boolean",
            JsonValueKind.Null => "null",
            _ => "undefined",
        };
}

public sealed class SessionRequestValidationException : Exception
{
    public SessionRequestValidationException(int statusCode, string error, IReadOnlyList<object>? issues = null)
        : base(error)
    {
        StatusCode = statusCode;
        Error = error;
        Issues = issues;
    }

    public int StatusCode { get; }

    public string Error { get; }

    public IReadOnlyList<object>? Issues { get; }
}
