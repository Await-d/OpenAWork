using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Features.Settings;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Host.Routes;

public static class SettingsRouteGroupExtensions
{
    private static readonly HashSet<string> ValidProviderTypes =
    [
        "anthropic",
        "openai",
        "deepseek",
        "gemini",
        "ollama",
        "openrouter",
        "qwen",
        "moonshot",
        "custom",
    ];

    private static readonly HashSet<string> ValidReasoningEfforts =
    ["minimal", "low", "medium", "high", "xhigh"];

    private static readonly HashSet<string> ValidUpstreamProtocols =
    ["chat_completions", "responses", "anthropic_messages"];

    private static readonly IReadOnlyDictionary<string, string> AllowedApiKeyEnvByType = new Dictionary<string, string>
    {
        ["anthropic"] = "ANTHROPIC_API_KEY",
        ["openai"] = "OPENAI_API_KEY",
        ["deepseek"] = "DEEPSEEK_API_KEY",
        ["gemini"] = "GEMINI_API_KEY",
        ["openrouter"] = "OPENROUTER_API_KEY",
        ["qwen"] = "QWEN_API_KEY",
        ["moonshot"] = "MOONSHOT_API_KEY",
    };

    public static IEndpointRouteBuilder MapSettingsRoutes(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/settings").RequireAuthorization();

        group.MapGet("/model-prices", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetModelPricesQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/workers", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetWorkersQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/companion", async Task<IResult> (string? agentId, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseCompanionAgentId(agentId, out var normalizedAgentId))
            {
                return Results.Json(new { error = "Invalid companion query", issues = new[] { CreateInvalidTypeIssue(new[] { "agentId" }, "string", "invalid", "Invalid companion query") } }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(new GetCompanionSettingsQuery(normalizedAgentId), cancellationToken);
            return Results.Ok(response);
        });

        group.MapPut("/companion", async Task<IResult> (string? agentId, JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseCompanionAgentId(agentId, out var normalizedAgentId))
            {
                return Results.Json(new { error = "Invalid companion query", issues = new[] { CreateInvalidTypeIssue(new[] { "agentId" }, "string", "invalid", "Invalid companion query") } }, statusCode: StatusCodes.Status400BadRequest);
            }

            if (!CompanionSettingsSupport.TryParseSettingsUpdate(body, out var update, out var issues))
            {
                return Results.Json(new { error = "Invalid companion settings", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(new UpdateCompanionSettingsCommand(normalizedAgentId, update), cancellationToken);
            return Results.Ok(response);
        });

        group.MapPost("/companion/chat", async Task<IResult> (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!CompanionSettingsSupport.TryParseChatRequest(body, out var request, out var issues))
            {
                return Results.Json(new { error = "Invalid input", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            request = request with
            {
                ApiBaseUrl = Environment.GetEnvironmentVariable("AI_API_BASE_URL"),
                ApiKey = Environment.GetEnvironmentVariable("AI_API_KEY"),
                Model = Environment.GetEnvironmentVariable("AI_DEFAULT_MODEL") ?? "gpt-4o",
            };

            try
            {
                var response = await sender.Send(new CompanionChatCommand(request), cancellationToken);
                return Results.Ok(response);
            }
            catch (InvalidOperationException invalidOperationException) when (invalidOperationException.Message == "Companion chat LLM is not configured")
            {
                return Results.Json(new { error = invalidOperationException.Message }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            catch
            {
                return Results.Json(new { error = "Companion chat failed" }, statusCode: StatusCodes.Status500InternalServerError);
            }
        });

        group.MapGet("/providers", async (bool? enabledOnly, ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetProvidersSettingsQuery(enabledOnly ?? false), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapPut("/providers", async (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseProvidersBody(body, out var providers, out var activeSelection, out var defaultThinking, out var issues))
            {
                return Results.Json(new { error = "Invalid provider config", issues }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(new UpdateProvidersSettingsCommand(providers, activeSelection, defaultThinking), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/active-selection", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetActiveSelectionSettingsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapPut("/active-selection", async (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            if (!TryParseActiveSelectionBody(body, out var normalizedSelection))
            {
                return Results.Json(new { error = "Invalid body" }, statusCode: StatusCodes.Status400BadRequest);
            }

            var response = await sender.Send(new UpdateActiveSelectionSettingsCommand(normalizedSelection), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/mcp-status", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetMcpStatusQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/mcp-servers", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetMcpServersQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapPut("/mcp-servers", async (JsonElement body, ISender sender, CancellationToken cancellationToken) =>
        {
            var servers = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("servers", out var value)
                ? value.Clone()
                : JsonSerializer.SerializeToElement<object?>(null);
            var response = await sender.Send(new UpdateMcpServersCommand(servers), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/upstream-retry", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetUpstreamRetrySettingsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapDelete("/diagnostics", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new DeleteDiagnosticsCommand(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/dev-logs", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetDevLogsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/version", async (ISender sender, string? channel, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetVersionQuery(channel), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/compaction", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetCompactionSettingsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        group.MapGet("/file-patterns", async (ISender sender, CancellationToken cancellationToken) =>
        {
            var response = await sender.Send(new GetFilePatternsQuery(), cancellationToken);
            return TypedResults.Ok(response);
        });

        return endpoints;
    }

    private static bool TryParseProvidersBody(
        JsonElement body,
        out IReadOnlyList<JsonElement> providers,
        out JsonElement? activeSelection,
        out JsonElement? defaultThinking,
        out List<object> issues)
    {
        providers = [];
        activeSelection = null;
        defaultThinking = null;
        issues = [];

        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeJsonKind(body.ValueKind), "Invalid provider config"));
            return false;
        }

        if (!body.TryGetProperty("providers", out var providersElement) || providersElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers" }, "array", body.TryGetProperty("providers", out var existingProviders) ? DescribeJsonKind(existingProviders.ValueKind) : "undefined", "Invalid provider config"));
            return false;
        }

        var normalizedProviders = new List<JsonElement>();
        foreach (var provider in providersElement.EnumerateArray())
        {
            if (!TryNormalizeProvider(provider, normalizedProviders.Count, out var normalizedProvider, out var providerIssues))
            {
                issues.AddRange(providerIssues);
                continue;
            }

            normalizedProviders.Add(normalizedProvider);
        }

        if (issues.Count > 0)
        {
            return false;
        }

        providers = normalizedProviders;

        if (body.TryGetProperty("activeSelection", out var activeSelectionElement))
        {
            if (!TryParseActiveSelectionBody(activeSelectionElement, out var normalizedSelection, requireChatAndFast: true))
            {
                issues.Add(new
                {
                    code = "invalid_active_selection",
                    path = new[] { "activeSelection" },
                    message = "Invalid activeSelection",
                });
                return false;
            }

            activeSelection = normalizedSelection;
        }

        if (body.TryGetProperty("defaultThinking", out var defaultThinkingElement))
        {
            if (!TryNormalizeDefaultThinking(defaultThinkingElement, out var normalizedDefaultThinking))
            {
                issues.Add(new
                {
                    code = "invalid_default_thinking",
                    path = new[] { "defaultThinking" },
                    message = "Invalid defaultThinking",
                });
                return false;
            }

            defaultThinking = normalizedDefaultThinking;
        }

        return true;
    }

    private static bool TryNormalizeProvider(
        JsonElement provider,
        int providerIndex,
        out JsonElement normalizedProvider,
        out List<object> issues)
    {
        normalizedProvider = default;
        issues = [];

        if (provider.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString() }, "object", DescribeJsonKind(provider.ValueKind), "Invalid provider config"));
            return false;
        }

        var id = ReadRequiredString(provider, providerIndex, "id", issues);
        var type = ReadRequiredString(provider, providerIndex, "type", issues);
        var name = ReadRequiredString(provider, providerIndex, "name", issues);
        var enabled = ReadRequiredBoolean(provider, providerIndex, "enabled", issues);

        string baseUrl = string.Empty;
        if (provider.TryGetProperty("baseUrl", out var baseUrlElement))
        {
            if (baseUrlElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "baseUrl" }, "string", DescribeJsonKind(baseUrlElement.ValueKind), "Invalid provider config"));
            }
            else
            {
                baseUrl = baseUrlElement.GetString() ?? string.Empty;
            }
        }

        if (!string.IsNullOrWhiteSpace(type) && !ValidProviderTypes.Contains(type))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { "providers", providerIndex.ToString(), "type" }, message = "Invalid provider type" });
        }

        if (type == "custom" && string.IsNullOrWhiteSpace(baseUrl))
        {
            issues.Add(new { code = "custom", path = new[] { "providers", providerIndex.ToString(), "baseUrl" }, message = "Custom providers require a baseUrl." });
        }

        if (!provider.TryGetProperty("defaultModels", out var modelsElement) || modelsElement.ValueKind != JsonValueKind.Array)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels" }, "array", provider.TryGetProperty("defaultModels", out var existingModels) ? DescribeJsonKind(existingModels.ValueKind) : "undefined", "Invalid provider config"));
        }

        var normalizedModels = new List<JsonElement>();
        if (modelsElement.ValueKind == JsonValueKind.Array)
        {
            var modelIndex = 0;
            foreach (var model in modelsElement.EnumerateArray())
            {
                if (!TryNormalizeModel(model, providerIndex, modelIndex, out var normalizedModel, out var modelIssues))
                {
                    issues.AddRange(modelIssues);
                }
                else
                {
                    normalizedModels.Add(normalizedModel);
                }

                modelIndex++;
            }
        }

        if (issues.Count > 0 || id is null || type is null || name is null || enabled is null)
        {
            return false;
        }

        var now = DateTimeOffset.UtcNow.ToString("O");
        var normalized = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["type"] = type,
            ["name"] = name,
            ["enabled"] = enabled.Value,
            ["baseUrl"] = baseUrl,
            ["defaultModels"] = normalizedModels,
            ["createdAt"] = ReadOptionalString(provider, "createdAt") ?? now,
            ["updatedAt"] = ReadOptionalString(provider, "updatedAt") ?? now,
        };

        var apiKey = ReadOptionalString(provider, "apiKey");
        if (apiKey is not null)
        {
            normalized["apiKey"] = apiKey;
        }

        var apiKeyEnv = ReadOptionalString(provider, "apiKeyEnv");
        if (AllowedApiKeyEnvByType.TryGetValue(type, out var allowedApiKeyEnv) && apiKeyEnv == allowedApiKeyEnv)
        {
            normalized["apiKeyEnv"] = apiKeyEnv;
        }

        if (provider.TryGetProperty("oauth", out var oauthElement))
        {
            if (!TryNormalizeOAuth(oauthElement, out var normalizedOauth))
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "oauth" }, "object", DescribeJsonKind(oauthElement.ValueKind), "Invalid provider config"));
                return false;
            }

            normalized["oauth"] = normalizedOauth!.Value;
        }

        if (provider.TryGetProperty("requestOverrides", out var requestOverridesElement))
        {
            if (!TryNormalizeRequestOverrides(requestOverridesElement, out var normalizedRequestOverrides))
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "requestOverrides" }, "object", DescribeJsonKind(requestOverridesElement.ValueKind), "Invalid provider config"));
                return false;
            }

            normalized["requestOverrides"] = normalizedRequestOverrides!.Value;
        }

        var upstreamProtocol = ReadOptionalString(provider, "upstreamProtocol");
        if (upstreamProtocol is not null)
        {
            if (!ValidUpstreamProtocols.Contains(upstreamProtocol))
            {
                issues.Add(new { code = "invalid_enum_value", path = new[] { "providers", providerIndex.ToString(), "upstreamProtocol" }, message = "Invalid upstreamProtocol" });
                return false;
            }

            normalized["upstreamProtocol"] = upstreamProtocol;
        }

        normalizedProvider = JsonSerializer.SerializeToElement(normalized);
        return true;
    }

    private static bool TryNormalizeModel(
        JsonElement model,
        int providerIndex,
        int modelIndex,
        out JsonElement normalizedModel,
        out List<object> issues)
    {
        normalizedModel = default;
        issues = [];

        if (model.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString() }, "object", DescribeJsonKind(model.ValueKind), "Invalid provider config"));
            return false;
        }

        var id = ReadRequiredString(model, providerIndex, modelIndex, "id", issues);
        var label = ReadRequiredString(model, providerIndex, modelIndex, "label", issues);
        var enabled = ReadRequiredBoolean(model, providerIndex, modelIndex, "enabled", issues);

        if (issues.Count > 0 || id is null || label is null || enabled is null)
        {
            return false;
        }

        var normalized = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["label"] = label,
            ["enabled"] = enabled.Value,
        };

        if (TryReadOptionalNonNegativeInteger(model, "contextWindow", out var contextWindow, out var contextIssue))
        {
            if (contextWindow is not null)
            {
                normalized["contextWindow"] = contextWindow.Value;
            }
        }
        else
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "contextWindow" }, "nonnegative integer", contextIssue!, "Invalid provider config"));
        }

        if (TryReadOptionalNonNegativeInteger(model, "maxOutputTokens", out var maxOutputTokens, out var maxOutputIssue))
        {
            if (maxOutputTokens is not null)
            {
                normalized["maxOutputTokens"] = maxOutputTokens.Value;
            }
        }
        else
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "maxOutputTokens" }, "nonnegative integer", maxOutputIssue!, "Invalid provider config"));
        }

        CopyOptionalBoolean(model, "supportsTools", normalized);
        CopyOptionalBoolean(model, "supportsVision", normalized);
        CopyOptionalBoolean(model, "supportsThinking", normalized);
        CopyOptionalNonNegativeNumber(model, "inputPricePerMillion", normalized, issues, providerIndex, modelIndex);
        CopyOptionalNonNegativeNumber(model, "outputPricePerMillion", normalized, issues, providerIndex, modelIndex);

        if (model.TryGetProperty("thinking", out var thinkingElement))
        {
            if (!TryNormalizeThinking(thinkingElement, providerIndex, modelIndex, out var normalizedThinking, out var thinkingIssues))
            {
                issues.AddRange(thinkingIssues);
            }
            else if (normalizedThinking is not null)
            {
                normalized["thinking"] = normalizedThinking;
            }
        }

        if (model.TryGetProperty("requestOverrides", out var requestOverridesElement))
        {
            if (!TryNormalizeRequestOverrides(requestOverridesElement, out var normalizedRequestOverrides))
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "requestOverrides" }, "object", DescribeJsonKind(requestOverridesElement.ValueKind), "Invalid provider config"));
            }
            else
            {
                normalized["requestOverrides"] = normalizedRequestOverrides!.Value;
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        normalizedModel = JsonSerializer.SerializeToElement(normalized);
        return true;
    }

    private static bool TryNormalizeThinking(
        JsonElement thinking,
        int providerIndex,
        int modelIndex,
        out JsonElement? normalizedThinking,
        out List<object> issues)
    {
        normalizedThinking = null;
        issues = [];

        if (thinking.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "thinking" }, "object", DescribeJsonKind(thinking.ValueKind), "Invalid provider config"));
            return false;
        }

        if (!thinking.TryGetProperty("enabled", out var enabledElement) || (enabledElement.ValueKind != JsonValueKind.True && enabledElement.ValueKind != JsonValueKind.False))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "thinking", "enabled" }, "boolean", thinking.TryGetProperty("enabled", out var existingEnabled) ? DescribeJsonKind(existingEnabled.ValueKind) : "undefined", "Invalid provider config"));
            return false;
        }

        var normalized = new Dictionary<string, object?>
        {
            ["enabled"] = enabledElement.GetBoolean(),
        };

        if (thinking.TryGetProperty("budgetTokens", out var budgetTokensElement))
        {
            if (budgetTokensElement.ValueKind != JsonValueKind.Number || !budgetTokensElement.TryGetInt64(out var budgetTokens) || budgetTokens <= 0)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "thinking", "budgetTokens" }, "positive integer", DescribeJsonKind(budgetTokensElement.ValueKind), "Invalid provider config"));
                return false;
            }

            normalized["budgetTokens"] = budgetTokens;
        }

        if (thinking.TryGetProperty("mode", out var modeElement))
        {
            if (modeElement.ValueKind != JsonValueKind.String || !ValidReasoningEfforts.Contains(modeElement.GetString() ?? string.Empty))
            {
                issues.Add(new { code = "invalid_enum_value", path = new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), "thinking", "mode" }, message = "Invalid thinking mode" });
                return false;
            }

            normalized["mode"] = modeElement.GetString();
        }

        normalizedThinking = JsonSerializer.SerializeToElement(normalized);
        return true;
    }

    private static bool TryParseActiveSelectionBody(JsonElement body, out JsonElement normalizedSelection, bool requireChatAndFast = false)
    {
        normalizedSelection = default;

        if (body.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var normalized = new Dictionary<string, object?>();
        foreach (var propertyName in new[] { "chat", "fast", "compaction" })
        {
            if (!body.TryGetProperty(propertyName, out var slot))
            {
                continue;
            }

            if (slot.ValueKind != JsonValueKind.Object
                || !slot.TryGetProperty("providerId", out var providerId)
                || providerId.ValueKind != JsonValueKind.String
                || !slot.TryGetProperty("modelId", out var modelId)
                || modelId.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            normalized[propertyName] = new Dictionary<string, object?>
            {
                ["providerId"] = providerId.GetString() ?? string.Empty,
                ["modelId"] = modelId.GetString() ?? string.Empty,
            };
        }

        if (requireChatAndFast && (!normalized.ContainsKey("chat") || !normalized.ContainsKey("fast")))
        {
            return false;
        }

        normalizedSelection = JsonSerializer.SerializeToElement(normalized);
        return true;
    }

    private static bool TryNormalizeOAuth(JsonElement oauth, out JsonElement? normalized)
    {
        normalized = null;
        if (oauth.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var output = new Dictionary<string, object?>();

        if (!TryCopyRequiredBoolean(oauth, "enabled", output))
        {
            return false;
        }

        foreach (var propertyName in new[] { "clientId", "clientSecret", "authorizeUrl", "tokenUrl", "revokeUrl", "scope", "audience" })
        {
            if (oauth.TryGetProperty(propertyName, out var property))
            {
                if (property.ValueKind != JsonValueKind.String)
                {
                    return false;
                }

                output[propertyName] = property.GetString();
            }
        }

        if (oauth.TryGetProperty("usePkce", out var usePkce))
        {
            if (usePkce.ValueKind != JsonValueKind.True && usePkce.ValueKind != JsonValueKind.False)
            {
                return false;
            }

            output["usePkce"] = usePkce.GetBoolean();
        }

        normalized = JsonSerializer.SerializeToElement(output);
        return true;
    }

    private static bool TryNormalizeRequestOverrides(JsonElement requestOverrides, out JsonElement? normalized)
    {
        normalized = null;
        if (requestOverrides.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var output = new Dictionary<string, object?>();

        if (!TryCopyOptionalNumber(requestOverrides, "temperature", 0, 2, output)) return false;
        if (!TryCopyOptionalNumber(requestOverrides, "topP", 0, 1, output)) return false;
        if (!TryCopyOptionalPositiveInteger(requestOverrides, "maxTokens", output)) return false;
        if (!TryCopyOptionalNumber(requestOverrides, "frequencyPenalty", -2, 2, output)) return false;
        if (!TryCopyOptionalNumber(requestOverrides, "presencePenalty", -2, 2, output)) return false;
        if (!TryCopyOptionalPositiveInteger(requestOverrides, "timeoutMs", output)) return false;

        if (requestOverrides.TryGetProperty("omitBodyKeys", out var omitBodyKeys))
        {
            if (omitBodyKeys.ValueKind != JsonValueKind.Array || omitBodyKeys.EnumerateArray().Any((item) => item.ValueKind != JsonValueKind.String))
            {
                return false;
            }

            output["omitBodyKeys"] = omitBodyKeys.EnumerateArray().Select((item) => item.GetString()).ToArray();
        }

        if (requestOverrides.TryGetProperty("headers", out var headers))
        {
            if (!TryNormalizeStringDictionary(headers, out var normalizedHeaders))
            {
                return false;
            }

            output["headers"] = normalizedHeaders;
        }

        if (requestOverrides.TryGetProperty("body", out var body))
        {
            if (body.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            output["body"] = body.Clone();
        }

        normalized = JsonSerializer.SerializeToElement(output);
        return true;
    }

    private static bool TryNormalizeStringDictionary(JsonElement element, out Dictionary<string, string>? normalized)
    {
        normalized = null;
        if (element.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var output = new Dictionary<string, string>();
        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            output[property.Name] = property.Value.GetString() ?? string.Empty;
        }

        normalized = output;
        return true;
    }

    private static bool TryCopyRequiredBoolean(JsonElement element, string propertyName, Dictionary<string, object?> output)
    {
        if (!element.TryGetProperty(propertyName, out var property) || (property.ValueKind != JsonValueKind.True && property.ValueKind != JsonValueKind.False))
        {
            return false;
        }

        output[propertyName] = property.GetBoolean();
        return true;
    }

    private static bool TryCopyOptionalPositiveInteger(JsonElement element, string propertyName, Dictionary<string, object?> output)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return true;
        }

        if (property.ValueKind != JsonValueKind.Number || !property.TryGetInt64(out var value) || value <= 0)
        {
            return false;
        }

        output[propertyName] = value;
        return true;
    }

    private static bool TryCopyOptionalNumber(JsonElement element, string propertyName, double min, double max, Dictionary<string, object?> output)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return true;
        }

        if (property.ValueKind != JsonValueKind.Number || !property.TryGetDouble(out var value) || value < min || value > max)
        {
            return false;
        }

        output[propertyName] = value;
        return true;
    }

    private static bool TryNormalizeDefaultThinking(JsonElement body, out JsonElement normalizedDefaultThinking)
    {
        normalizedDefaultThinking = default;
        if (body.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var normalized = new Dictionary<string, object?>();
        foreach (var mode in new[] { "chat", "fast" })
        {
            if (!body.TryGetProperty(mode, out var entry) || entry.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            if (!entry.TryGetProperty("enabled", out var enabledElement) || (enabledElement.ValueKind != JsonValueKind.True && enabledElement.ValueKind != JsonValueKind.False))
            {
                return false;
            }

            if (!entry.TryGetProperty("effort", out var effortElement) || effortElement.ValueKind != JsonValueKind.String || !ValidReasoningEfforts.Contains(effortElement.GetString() ?? string.Empty))
            {
                return false;
            }

            normalized[mode] = new Dictionary<string, object?>
            {
                ["enabled"] = enabledElement.GetBoolean(),
                ["effort"] = effortElement.GetString(),
            };
        }

        normalizedDefaultThinking = JsonSerializer.SerializeToElement(normalized);
        return true;
    }

    private static string? ReadRequiredString(JsonElement element, int providerIndex, string propertyName, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), propertyName }, "string", "undefined", "Invalid provider config"));
            return null;
        }

        if (property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), propertyName }, "string", DescribeJsonKind(property.ValueKind), "Invalid provider config"));
            return null;
        }

        return property.GetString();
    }

    private static string? ReadRequiredString(JsonElement element, int providerIndex, int modelIndex, string propertyName, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), propertyName }, "string", "undefined", "Invalid provider config"));
            return null;
        }

        if (property.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(property.GetString()))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), propertyName }, "string", DescribeJsonKind(property.ValueKind), "Invalid provider config"));
            return null;
        }

        return property.GetString();
    }

    private static bool? ReadRequiredBoolean(JsonElement element, int providerIndex, string propertyName, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), propertyName }, "boolean", "undefined", "Invalid provider config"));
            return null;
        }

        if (property.ValueKind != JsonValueKind.True && property.ValueKind != JsonValueKind.False)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), propertyName }, "boolean", DescribeJsonKind(property.ValueKind), "Invalid provider config"));
            return null;
        }

        return property.GetBoolean();
    }

    private static bool? ReadRequiredBoolean(JsonElement element, int providerIndex, int modelIndex, string propertyName, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), propertyName }, "boolean", "undefined", "Invalid provider config"));
            return null;
        }

        if (property.ValueKind != JsonValueKind.True && property.ValueKind != JsonValueKind.False)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), propertyName }, "boolean", DescribeJsonKind(property.ValueKind), "Invalid provider config"));
            return null;
        }

        return property.GetBoolean();
    }

    private static string? ReadOptionalString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static bool TryReadOptionalNonNegativeInteger(JsonElement element, string propertyName, out long? value, out string? issue)
    {
        value = null;
        issue = null;

        if (!element.TryGetProperty(propertyName, out var property))
        {
            return true;
        }

        if (property.ValueKind != JsonValueKind.Number || !property.TryGetInt64(out var parsed) || parsed < 0)
        {
            issue = DescribeJsonKind(property.ValueKind);
            return false;
        }

        value = parsed;
        return true;
    }

    private static void CopyOptionalBoolean(JsonElement element, string propertyName, Dictionary<string, object?> normalized)
    {
        if (element.TryGetProperty(propertyName, out var property) && (property.ValueKind == JsonValueKind.True || property.ValueKind == JsonValueKind.False))
        {
            normalized[propertyName] = property.GetBoolean();
        }
    }

    private static void CopyOptionalNonNegativeNumber(JsonElement element, string propertyName, Dictionary<string, object?> normalized, List<object> issues, int providerIndex, int modelIndex)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return;
        }

        if (property.ValueKind != JsonValueKind.Number || !property.TryGetDouble(out var number) || number < 0)
        {
            issues.Add(CreateInvalidTypeIssue(new[] { "providers", providerIndex.ToString(), "defaultModels", modelIndex.ToString(), propertyName }, "nonnegative number", DescribeJsonKind(property.ValueKind), "Invalid provider config"));
            return;
        }

        normalized[propertyName] = number;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received, string message) => new
    {
        code = "invalid_type",
        expected,
        received,
        path,
        message,
    };

    private static bool TryParseCompanionAgentId(string? agentId, out string? normalizedAgentId)
    {
        normalizedAgentId = null;
        if (agentId is null)
        {
            return true;
        }

        var trimmed = agentId.Trim();
        if (trimmed.Length == 0 || trimmed.Length > 120)
        {
            return false;
        }

        normalizedAgentId = trimmed;
        return true;
    }

    private static string DescribeJsonKind(JsonValueKind kind) => kind switch
    {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Object => "object",
        JsonValueKind.Array => "array",
        JsonValueKind.Null => "null",
        JsonValueKind.Undefined => "undefined",
        _ => "unknown",
    };
}
