using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Features.Agents;
using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Host.Routes;

public static class AgentsRouteGroupExtensions
{
    private const int MaxAliasesPerAgent = 32;
    private const int MaxFallbackModelsPerAgent = 32;
    private const int MaxOverlaysPerRole = 4;
    private static readonly HashSet<string> ValidCoreRoles = ["general", "researcher", "planner", "executor", "reviewer"];
    private static readonly HashSet<string> ValidPresets = ["default", "explore", "analyst", "librarian", "architect", "debugger", "critic", "code-review", "test", "verifier"];
    private static readonly HashSet<string> ValidOverlays = ["writer", "multimodal"];
    private static readonly HashSet<string> ValidConfidence = ["low", "medium", "high"];

    public static IEndpointRouteBuilder MapAgentsRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/agents").RequireAuthorization().RequireRateLimiting("auth");

        group.MapGet(string.Empty, async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetManagedAgentsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapPost(string.Empty, async Task<IResult> (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseCreateBody(body, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid create payload", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(command!, cancellationToken);
                return Results.Json(response, statusCode: StatusCodes.Status201Created);
            }
            catch (InvalidOperationException exception) when (exception.Message == "Custom agent systemPrompt is required")
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status400BadRequest);
            }
            catch (InvalidOperationException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status409Conflict);
            }
        });

        group.MapPut("/{agentId}", async Task<IResult> (string agentId, JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryNormalizeAgentId(agentId, out var normalizedAgentId, out var agentIdIssue))
            {
                return Results.Json(new { error = "Invalid agentId", issues = new[] { agentIdIssue } }, statusCode: StatusCodes.Status400BadRequest);
            }

            if (!TryParseUpdateBody(body, normalizedAgentId!, out var command, out var issues))
            {
                return Results.Json(new { error = "Invalid update payload", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(command!, cancellationToken);
                return Results.Ok(response);
            }
            catch (InvalidOperationException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status400BadRequest);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapDelete("/{agentId}", async Task<IResult> (string agentId, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryNormalizeAgentId(agentId, out var normalizedAgentId, out var agentIdIssue))
            {
                return Results.Json(new { error = "Invalid agentId", issues = new[] { agentIdIssue } }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                await sender.Send(new RemoveManagedAgentCommand(normalizedAgentId!), cancellationToken);
                return Results.NoContent();
            }
            catch (InvalidOperationException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status409Conflict);
            }
        });

        group.MapPost("/{agentId}/reset", async Task<IResult> (string agentId, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryNormalizeAgentId(agentId, out var normalizedAgentId, out var agentIdIssue))
            {
                return Results.Json(new { error = "Invalid agentId", issues = new[] { agentIdIssue } }, statusCode: StatusCodes.Status400BadRequest);
            }

            try
            {
                var response = await sender.Send(new ResetManagedAgentCommand(normalizedAgentId!), cancellationToken);
                return Results.Ok(response);
            }
            catch (KeyNotFoundException exception)
            {
                return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status404NotFound);
            }
        });

        group.MapPost("/reset-all", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new ResetAllManagedAgentsCommand(), cancellationToken);
            return TypedResults.Ok(response);
        });

        return endpoints;
    }

    private static bool TryParseCreateBody(
        JsonElement body,
        out CreateManagedAgentCommand? command,
        out List<object> issues)
    {
        command = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue([], "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        var id = ReadOptionalString(body, "id", 120, issues, minimumLength: 1, trim: true);
        var label = ReadRequiredString(body, "label", 80, issues);
        var description = ReadOptionalString(body, "description", 400, issues) ?? string.Empty;
        var aliases = ReadOptionalStringArray(body, "aliases", 80, MaxAliasesPerAgent, issues) ?? [];
        var canonicalRole = ReadOptionalCanonicalRole(body, "canonicalRole", issues);
        var model = ReadOptionalString(body, "model", 200, issues, minimumLength: 1, trim: true);
        var variant = ReadOptionalString(body, "variant", 80, issues, minimumLength: 1, trim: true);
        var fallbackModels = ReadOptionalStringArray(body, "fallbackModels", 200, MaxFallbackModelsPerAgent, issues) ?? [];
        var systemPrompt = ReadRequiredString(body, "systemPrompt", 4000, issues, minimumLength: 1, trim: true);
        var note = ReadOptionalString(body, "note", 400, issues);
        var enabled = ReadOptionalBoolean(body, "enabled", issues);

        if (issues.Count > 0 || label is null || systemPrompt is null)
        {
            return false;
        }

        command = new CreateManagedAgentCommand(id, label, description, aliases, canonicalRole, model, variant, fallbackModels, systemPrompt, note, enabled);
        return true;
    }

    private static bool TryParseUpdateBody(
        JsonElement body,
        string agentId,
        out UpdateManagedAgentCommand? command,
        out List<object> issues)
    {
        command = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue([], "object", DescribeJsonKind(body.ValueKind)));
            return false;
        }

        var seenKnownField = false;

        var label = ReadOptionalString(body, "label", 80, issues, minimumLength: 1, trim: true, out var hasLabel);
        seenKnownField |= hasLabel;
        var description = ReadOptionalString(body, "description", 400, issues, out var hasDescription);
        seenKnownField |= hasDescription;
        var aliases = ReadOptionalStringArray(body, "aliases", 80, MaxAliasesPerAgent, issues, out var hasAliases);
        seenKnownField |= hasAliases;
        var canonicalRole = ReadOptionalCanonicalRole(body, "canonicalRole", issues, out var hasCanonicalRole);
        seenKnownField |= hasCanonicalRole;
        var model = ReadOptionalString(body, "model", 200, issues, minimumLength: 1, trim: true, out var hasModel);
        seenKnownField |= hasModel;
        var variant = ReadOptionalString(body, "variant", 80, issues, minimumLength: 1, trim: true, out var hasVariant);
        seenKnownField |= hasVariant;
        var fallbackModels = ReadOptionalStringArray(body, "fallbackModels", 200, MaxFallbackModelsPerAgent, issues, out var hasFallbackModels);
        seenKnownField |= hasFallbackModels;
        var systemPrompt = ReadOptionalString(body, "systemPrompt", 4000, issues, minimumLength: 0, trim: true, out var hasSystemPrompt);
        seenKnownField |= hasSystemPrompt;
        var note = ReadOptionalString(body, "note", 400, issues, out var hasNote);
        seenKnownField |= hasNote;
        var enabled = ReadOptionalBoolean(body, "enabled", issues, out var hasEnabled);
        seenKnownField |= hasEnabled;

        if (!seenKnownField)
        {
            issues.Add(new
            {
                code = "missing_fields",
                path = Array.Empty<string>(),
                message = "At least one field is required",
            });
        }

        if (issues.Count > 0)
        {
            return false;
        }

        command = new UpdateManagedAgentCommand(agentId, label, description, aliases, canonicalRole, model, variant, fallbackModels, systemPrompt, note, enabled);
        return true;
    }

    private static bool TryNormalizeAgentId(string? agentId, out string? normalizedAgentId, out object? issue)
    {
        normalizedAgentId = agentId?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedAgentId))
        {
            issue = CreateTooSmallStringIssue(["agentId"], 1);
            return false;
        }

        if (normalizedAgentId.Length > 120)
        {
            issue = CreateTooBigStringIssue(["agentId"], 120);
            return false;
        }

        issue = null;
        return true;
    }

    private static CanonicalRoleResponse? ReadOptionalCanonicalRole(
        JsonElement body,
        string propertyName,
        List<object> issues)
    {
        return ReadOptionalCanonicalRole(body, propertyName, issues, out _);
    }

    private static CanonicalRoleResponse? ReadOptionalCanonicalRole(
        JsonElement body,
        string propertyName,
        List<object> issues,
        out bool propertyPresent)
    {
        propertyPresent = body.TryGetProperty(propertyName, out var canonicalRoleElement);
        if (!propertyPresent)
        {
            return null;
        }

        if (canonicalRoleElement.ValueKind == JsonValueKind.Null)
        {
            issues.Add(CreateInvalidTypeIssue([propertyName], "object", "null"));
            return null;
        }

        if (canonicalRoleElement.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue([propertyName], "object", DescribeJsonKind(canonicalRoleElement.ValueKind)));
            return null;
        }

        var coreRole = ReadRequiredString(canonicalRoleElement, "coreRole", 40, issues, pathPrefix: [propertyName]);
        var preset = ReadOptionalString(canonicalRoleElement, "preset", 40, issues, pathPrefix: [propertyName]);
        var overlays = ReadOptionalStringArray(canonicalRoleElement, "overlays", 40, MaxOverlaysPerRole, issues, pathPrefix: [propertyName]);
        var confidence = ReadOptionalString(canonicalRoleElement, "confidence", 20, issues, pathPrefix: [propertyName]);

        if (coreRole is not null && !ValidCoreRoles.Contains(coreRole))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { propertyName, "coreRole" }, message = "Invalid coreRole" });
        }

        if (preset is not null && !ValidPresets.Contains(preset))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { propertyName, "preset" }, message = "Invalid preset" });
        }

        if (confidence is not null && !ValidConfidence.Contains(confidence))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { propertyName, "confidence" }, message = "Invalid confidence" });
        }

        if (overlays is not null)
        {
            for (var index = 0; index < overlays.Count; index++)
            {
                if (!ValidOverlays.Contains(overlays[index]))
                {
                    issues.Add(new { code = "invalid_enum_value", path = new[] { propertyName, "overlays", index.ToString() }, message = "Invalid overlay" });
                }
            }
        }

        if (coreRole is null)
        {
            return null;
        }

        return new CanonicalRoleResponse(coreRole, preset, overlays, confidence);
    }

    private static string? ReadRequiredString(
        JsonElement body,
        string propertyName,
        int maxLength,
        List<object> issues,
        int minimumLength = 1,
        bool trim = true,
        string[]? pathPrefix = null)
    {
        if (!body.TryGetProperty(propertyName, out var element))
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", "undefined"));
            return null;
        }

        return ReadStringElement(element, propertyName, maxLength, minimumLength, trim, issues, pathPrefix);
    }

    private static string? ReadOptionalString(
        JsonElement body,
        string propertyName,
        int maxLength,
        List<object> issues,
        int minimumLength = 0,
        bool trim = true,
        string[]? pathPrefix = null)
    {
        return ReadOptionalString(body, propertyName, maxLength, issues, minimumLength, trim, out _, pathPrefix);
    }

    private static string? ReadOptionalString(
        JsonElement body,
        string propertyName,
        int maxLength,
        List<object> issues,
        out bool propertyPresent,
        string[]? pathPrefix = null)
    {
        return ReadOptionalString(body, propertyName, maxLength, issues, 0, true, out propertyPresent, pathPrefix);
    }

    private static string? ReadOptionalString(
        JsonElement body,
        string propertyName,
        int maxLength,
        List<object> issues,
        int minimumLength,
        bool trim,
        out bool propertyPresent,
        string[]? pathPrefix = null)
    {
        propertyPresent = body.TryGetProperty(propertyName, out var element);
        if (!propertyPresent)
        {
            return null;
        }

        return ReadStringElement(element, propertyName, maxLength, minimumLength, trim, issues, pathPrefix);
    }

    private static string? ReadStringElement(
        JsonElement element,
        string propertyName,
        int maxLength,
        int minimumLength,
        bool trim,
        List<object> issues,
        string[]? pathPrefix)
    {
        if (element.ValueKind == JsonValueKind.Null)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", "null"));
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "string", DescribeJsonKind(element.ValueKind)));
            return null;
        }

        var value = element.GetString() ?? string.Empty;
        if (trim)
        {
            value = value.Trim();
        }

        if (value.Length < minimumLength)
        {
            issues.Add(new { code = "too_small", path = BuildPath(pathPrefix, propertyName), message = $"String must contain at least {minimumLength} character(s)" });
            return null;
        }

        if (value.Length > maxLength)
        {
            issues.Add(new { code = "too_big", path = BuildPath(pathPrefix, propertyName), message = $"String must contain at most {maxLength} character(s)" });
            return null;
        }

        return value;
    }

    private static List<string>? ReadOptionalStringArray(
        JsonElement body,
        string propertyName,
        int maxItemLength,
        int maxItemCount,
        List<object> issues,
        string[]? pathPrefix = null)
    {
        return ReadOptionalStringArray(body, propertyName, maxItemLength, maxItemCount, issues, out _, pathPrefix);
    }

    private static List<string>? ReadOptionalStringArray(
        JsonElement body,
        string propertyName,
        int maxItemLength,
        int maxItemCount,
        List<object> issues,
        out bool propertyPresent,
        string[]? pathPrefix = null)
    {
        propertyPresent = body.TryGetProperty(propertyName, out var arrayElement);
        if (!propertyPresent)
        {
            return null;
        }

        if (arrayElement.ValueKind == JsonValueKind.Null)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "array", "null"));
            return null;
        }

        if (arrayElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(BuildPath(pathPrefix, propertyName), "array", DescribeJsonKind(arrayElement.ValueKind)));
            return null;
        }

        if (arrayElement.GetArrayLength() > maxItemCount)
        {
            issues.Add(new
            {
                code = "too_big",
                path = BuildPath(pathPrefix, propertyName),
                message = $"Array must contain at most {maxItemCount} item(s)",
            });
            return null;
        }

        var values = new List<string>();
        var index = 0;
        foreach (var item in arrayElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                issues.Add(CreateInvalidTypeIssue(BuildPath(BuildPath(pathPrefix, propertyName), index.ToString()), "string", DescribeJsonKind(item.ValueKind)));
                index += 1;
                continue;
            }

            var normalized = item.GetString()?.Trim() ?? string.Empty;
            if (normalized.Length == 0 || normalized.Length > maxItemLength)
            {
                issues.Add(new { code = normalized.Length == 0 ? "too_small" : "too_big", path = BuildPath(BuildPath(pathPrefix, propertyName), index.ToString()), message = normalized.Length == 0 ? "String must contain at least 1 character(s)" : $"String must contain at most {maxItemLength} character(s)" });
                index += 1;
                continue;
            }

            if (!values.Contains(normalized, StringComparer.Ordinal))
            {
                values.Add(normalized);
            }

            index += 1;
        }

        return values;
    }

    private static bool? ReadOptionalBoolean(JsonElement body, string propertyName, List<object> issues)
    {
        return ReadOptionalBoolean(body, propertyName, issues, out _);
    }

    private static bool? ReadOptionalBoolean(JsonElement body, string propertyName, List<object> issues, out bool propertyPresent)
    {
        propertyPresent = body.TryGetProperty(propertyName, out var element);
        if (!propertyPresent)
        {
            return null;
        }

        if (element.ValueKind == JsonValueKind.True)
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.False)
        {
            return false;
        }

        issues.Add(CreateInvalidTypeIssue([propertyName], "boolean", DescribeJsonKind(element.ValueKind)));
        return null;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received)
        => new { code = "invalid_type", path, expected, received, message = $"Expected {expected}" };

    private static object CreateTooSmallStringIssue(string[] path, int minimum)
        => new { code = "too_small", minimum, type = "string", inclusive = true, exact = false, path, message = $"String must contain at least {minimum} character(s)" };

    private static object CreateTooBigStringIssue(string[] path, int maximum)
        => new { code = "too_big", maximum, type = "string", inclusive = true, exact = false, path, message = $"String must contain at most {maximum} character(s)" };

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

    private static string[] BuildPath(string[]? prefix, string segment)
        => prefix is null ? [segment] : [.. prefix, segment];
}
