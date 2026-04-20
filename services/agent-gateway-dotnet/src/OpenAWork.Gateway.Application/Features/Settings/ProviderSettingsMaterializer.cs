using System.Text.Json;
using System.Text.RegularExpressions;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public static class ProviderSettingsMaterializer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly IReadOnlyList<JsonElement> BuiltinProviders =
    [
        CreateBuiltinProvider("anthropic", "anthropic", "Anthropic", true, "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY",
        [
            CreateBuiltinModel("claude-opus-4-0", "Claude Opus 4", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 15m, outputPricePerMillion: 75m),
            CreateBuiltinModel("claude-sonnet-4-0", "Claude Sonnet 4", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 3m, outputPricePerMillion: 15m),
            CreateBuiltinModel("claude-haiku-4-5", "Claude Haiku 4.5", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 1m, outputPricePerMillion: 5m),
            CreateBuiltinModel("claude-3-7-sonnet-20250219", "Claude Sonnet 3.7", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 3m, outputPricePerMillion: 15m),
            CreateBuiltinModel("claude-3-5-haiku-20241022", "Claude Haiku 3.5", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.8m, outputPricePerMillion: 4m),
        ]),
        CreateBuiltinProvider("openai", "openai", "OpenAI", true, "https://api.openai.com/v1", "OPENAI_API_KEY",
        [
            CreateBuiltinModel("gpt-4.1", "GPT-4.1", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 2m, outputPricePerMillion: 8m),
            CreateBuiltinModel("gpt-4.1-mini", "GPT-4.1 mini", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.4m, outputPricePerMillion: 1.6m),
            CreateBuiltinModel("gpt-4.1-nano", "GPT-4.1 nano", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.1m, outputPricePerMillion: 0.4m),
            CreateBuiltinModel("o3", "o3", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 2m, outputPricePerMillion: 8m),
            CreateBuiltinModel("o4-mini", "o4-mini", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 1.1m, outputPricePerMillion: 4.4m),
            CreateBuiltinModel("gpt-4o", "GPT-4o", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 2.5m, outputPricePerMillion: 10m),
            CreateBuiltinModel("gpt-4o-mini", "GPT-4o mini", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.15m, outputPricePerMillion: 0.6m),
        ]),
        CreateBuiltinProvider("deepseek", "deepseek", "DeepSeek", true, "https://api.deepseek.com", "DEEPSEEK_API_KEY",
        [
            CreateBuiltinModel("deepseek-chat", "DeepSeek Chat (V3)", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.28m, outputPricePerMillion: 0.42m),
            CreateBuiltinModel("deepseek-reasoner", "DeepSeek Reasoner (R1)", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.28m, outputPricePerMillion: 0.42m),
        ]),
        CreateBuiltinProvider("gemini", "gemini", "Google Gemini", true, "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY",
        [
            CreateBuiltinModel("gemini-2.5-pro", "Gemini 2.5 Pro", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 1.25m, outputPricePerMillion: 10m),
            CreateBuiltinModel("gemini-2.5-flash", "Gemini 2.5 Flash", true, supportsTools: true, supportsVision: true, supportsThinking: true, inputPricePerMillion: 0.3m, outputPricePerMillion: 2.5m),
            CreateBuiltinModel("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.1m, outputPricePerMillion: 0.4m),
            CreateBuiltinModel("gemini-2.0-flash", "Gemini 2.0 Flash", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.1m, outputPricePerMillion: 0.4m),
        ]),
        CreateBuiltinProvider("ollama", "ollama", "Ollama", false, "http://localhost:11434/v1", null,
        [
            CreateBuiltinModel("qwen3:8b", "Qwen3 8B (local)", true, inputPricePerMillion: 0m, outputPricePerMillion: 0m),
            CreateBuiltinModel("llama3.1:8b", "Llama 3.1 8B (local)", true, inputPricePerMillion: 0m, outputPricePerMillion: 0m),
        ]),
        CreateBuiltinProvider("openrouter", "openrouter", "OpenRouter", false, "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY",
        [
            CreateBuiltinModel("anthropic/claude-sonnet-4-0", "Claude Sonnet 4 (OpenRouter)", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 3m, outputPricePerMillion: 15m),
            CreateBuiltinModel("openai/gpt-4.1", "GPT-4.1 (OpenRouter)", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 2m, outputPricePerMillion: 8m),
            CreateBuiltinModel("google/gemini-2.5-pro", "Gemini 2.5 Pro (OpenRouter)", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 1.25m, outputPricePerMillion: 10m),
            CreateBuiltinModel("openai/gpt-4o-mini", "GPT-4o mini (OpenRouter)", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 0.15m, outputPricePerMillion: 0.6m),
        ]),
        CreateBuiltinProvider("qwen", "qwen", "Qwen", false, "https://dashscope.aliyuncs.com/compatible-mode/v1", "QWEN_API_KEY",
        [
            CreateBuiltinModel("qwen3-235b-a22b", "Qwen3 235B-A22B", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.7m, outputPricePerMillion: 2.8m),
            CreateBuiltinModel("qwen-max", "Qwen Max", true, supportsTools: true, supportsVision: true, inputPricePerMillion: 1.6m, outputPricePerMillion: 6.4m),
            CreateBuiltinModel("qwen-plus", "Qwen Plus", true, supportsTools: true, inputPricePerMillion: 0.4m, outputPricePerMillion: 1.2m),
            CreateBuiltinModel("qwen-turbo", "Qwen Turbo", true, supportsTools: true, inputPricePerMillion: 0.05m, outputPricePerMillion: 0.2m),
            CreateBuiltinModel("qwq-plus", "QwQ Plus", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.8m, outputPricePerMillion: 2.4m),
        ]),
        CreateBuiltinProvider("moonshot", "moonshot", "Moonshot (Kimi)", false, "https://api.moonshot.cn/v1", "MOONSHOT_API_KEY",
        [
            CreateBuiltinModel("kimi-k2.5", "Kimi K2.5", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.6m, outputPricePerMillion: 3m),
            CreateBuiltinModel("kimi-k2-thinking", "Kimi K2 Thinking", true, supportsTools: true, supportsThinking: true, inputPricePerMillion: 0.6m, outputPricePerMillion: 2.5m),
            CreateBuiltinModel("kimi-k2-turbo-preview", "Kimi K2 Turbo", true, supportsTools: true, inputPricePerMillion: 2.4m, outputPricePerMillion: 10m),
        ]),
    ];

    public static IReadOnlyList<JsonElement> MaterializeProviders(IReadOnlyList<JsonElement>? providers)
    {
        var userProviders = providers?.Select((provider) => provider.Clone()).ToList() ?? [];
        var materialized = new List<JsonElement>();

        foreach (var builtin in BuiltinProviders)
        {
            var builtinType = GetString(builtin, "type");
            var existing = userProviders.FirstOrDefault((provider) => GetString(provider, "type") == builtinType);
            materialized.Add(existing.ValueKind == JsonValueKind.Undefined
                ? builtin.Clone()
                : MergeBuiltinProvider(builtin, existing));
        }

        foreach (var provider in userProviders)
        {
            if (!IsBuiltin(provider))
            {
                materialized.Add(NormalizeCustomProvider(provider));
            }
        }

        return materialized;
    }

    public static IReadOnlyList<JsonElement> ParseStoredProviders(string? rawProviders)
    {
        if (string.IsNullOrWhiteSpace(rawProviders))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(rawProviders);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var validProviders = new List<JsonElement>();
            foreach (var provider in document.RootElement.EnumerateArray())
            {
                if (TryNormalizeStoredProvider(provider, out var normalizedProvider))
                {
                    validProviders.Add(normalizedProvider);
                }
            }

            return validProviders;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static ActiveSelectionResponse MaterializeActiveSelection(IReadOnlyList<JsonElement> providers, string? rawSelection)
    {
        ActiveSelectionResponse selection;
        if (string.IsNullOrWhiteSpace(rawSelection))
        {
            selection = EmptySelection();
        }
        else
        {
            selection = GetActiveSelectionSettingsQueryHandler.ParseActiveSelection(rawSelection);
        }

        var candidates = BuildCandidates(providers);
        var first = candidates.FirstOrDefault() ?? new ActiveSelectionItemResponse(string.Empty, string.Empty);
        var second = candidates.Skip(1).FirstOrDefault() ?? first;

        return new ActiveSelectionResponse(
            IsValidSelection(providers, selection.Chat) ? selection.Chat : first,
            IsValidSelection(providers, selection.Fast) ? selection.Fast : second,
            null);
    }

    private static JsonElement MergeBuiltinProvider(JsonElement builtin, JsonElement existing)
    {
        var merged = existing.EnumerateObject().ToDictionary((property) => property.Name, (property) => property.Value.Clone());
        merged["id"] = builtin.GetProperty("id").Clone();
        merged["type"] = builtin.GetProperty("type").Clone();
        merged["name"] = builtin.GetProperty("name").Clone();

        var existingBaseUrl = GetString(existing, "baseUrl");
        var builtinBaseUrl = GetString(builtin, "baseUrl");
        merged["baseUrl"] = JsonSerializer.SerializeToElement(NormalizeBaseUrl(string.IsNullOrWhiteSpace(existingBaseUrl) ? builtinBaseUrl : existingBaseUrl));

        var existingApiKeyEnv = GetString(existing, "apiKeyEnv");
        var builtinApiKeyEnv = GetOptionalElement(builtin, "apiKeyEnv");
        if (!string.IsNullOrWhiteSpace(existingApiKeyEnv))
        {
            merged["apiKeyEnv"] = JsonSerializer.SerializeToElement(existingApiKeyEnv);
        }
        else if (builtinApiKeyEnv is not null)
        {
            merged["apiKeyEnv"] = builtinApiKeyEnv.Value.Clone();
        }

        merged["defaultModels"] = JsonSerializer.SerializeToElement(MergeBuiltinModels(builtin, existing));
        merged["updatedAt"] = JsonSerializer.SerializeToElement(DateTimeOffset.UtcNow.ToString("O"));
        if (!merged.ContainsKey("createdAt"))
        {
            merged["createdAt"] = JsonSerializer.SerializeToElement(DateTimeOffset.UtcNow.ToString("O"));
        }

        return JsonSerializer.SerializeToElement(merged, JsonOptions);
    }

    private static IReadOnlyList<JsonElement> MergeBuiltinModels(JsonElement builtin, JsonElement existing)
    {
        var builtinModels = GetModels(builtin).ToList();
        var existingModels = GetModels(existing).ToList();
        var merged = new List<JsonElement>();

        foreach (var builtinModel in builtinModels)
        {
            var builtinModelId = GetString(builtinModel, "id");
            var existingModel = existingModels.FirstOrDefault((model) => GetString(model, "id") == builtinModelId);
            if (existingModel.ValueKind == JsonValueKind.Undefined)
            {
                merged.Add(builtinModel.Clone());
                continue;
            }

            var mergedModel = existingModel.EnumerateObject().ToDictionary((property) => property.Name, (property) => property.Value.Clone());
            foreach (var property in builtinModel.EnumerateObject())
            {
                if (property.NameEquals("enabled"))
                {
                    continue;
                }

                mergedModel[property.Name] = property.Value.Clone();
            }

            merged.Add(JsonSerializer.SerializeToElement(mergedModel, JsonOptions));
        }

        foreach (var existingModel in existingModels)
        {
            var existingModelId = GetString(existingModel, "id");
            if (!builtinModels.Any((model) => GetString(model, "id") == existingModelId))
            {
                merged.Add(existingModel.Clone());
            }
        }

        return merged;
    }

    private static JsonElement NormalizeCustomProvider(JsonElement provider)
    {
        var normalized = provider.EnumerateObject().ToDictionary((property) => property.Name, (property) => property.Value.Clone());
        normalized["baseUrl"] = JsonSerializer.SerializeToElement(NormalizeBaseUrl(GetString(provider, "baseUrl")));
        normalized["updatedAt"] = JsonSerializer.SerializeToElement(DateTimeOffset.UtcNow.ToString("O"));
        if (!normalized.ContainsKey("createdAt"))
        {
            normalized["createdAt"] = JsonSerializer.SerializeToElement(DateTimeOffset.UtcNow.ToString("O"));
        }

        return JsonSerializer.SerializeToElement(normalized, JsonOptions);
    }

    private static bool TryNormalizeStoredProvider(JsonElement provider, out JsonElement normalizedProvider)
    {
        normalizedProvider = default;
        if (provider.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        var id = GetString(provider, "id");
        var type = GetString(provider, "type");
        var name = GetString(provider, "name");

        if (string.IsNullOrWhiteSpace(id)
            || string.IsNullOrWhiteSpace(type)
            || string.IsNullOrWhiteSpace(name)
            || !provider.TryGetProperty("enabled", out var enabledProperty)
            || (enabledProperty.ValueKind != JsonValueKind.True && enabledProperty.ValueKind != JsonValueKind.False)
            || !GetModels(provider).Any())
        {
            return false;
        }

        normalizedProvider = IsBuiltin(provider)
            ? MergeBuiltinProvider(BuiltinProviders.First((builtin) => GetString(builtin, "type") == type), provider)
            : NormalizeCustomProvider(provider);
        return true;
    }

    private static IReadOnlyList<ActiveSelectionItemResponse> BuildCandidates(IReadOnlyList<JsonElement> providers)
    {
        return providers
            .Where(IsEnabled)
            .Select((provider) =>
            {
                var model = GetModels(provider).FirstOrDefault(IsEnabled);
                return model.ValueKind == JsonValueKind.Undefined
                    ? null
                    : new ActiveSelectionItemResponse(GetString(provider, "id"), GetString(model, "id"));
            })
            .Where((item) => item is not null)
            .Select((item) => item!)
            .ToList();
    }

    private static bool IsValidSelection(IReadOnlyList<JsonElement> providers, ActiveSelectionItemResponse selection)
    {
        if (string.IsNullOrWhiteSpace(selection.ProviderId) || string.IsNullOrWhiteSpace(selection.ModelId))
        {
            return false;
        }

        var provider = providers.FirstOrDefault((item) => GetString(item, "id") == selection.ProviderId);
        if (provider.ValueKind == JsonValueKind.Undefined || !IsEnabled(provider))
        {
            return false;
        }

        return GetModels(provider).Any((model) => IsEnabled(model) && GetString(model, "id") == selection.ModelId);
    }

    private static bool IsBuiltin(JsonElement provider)
    {
        var type = GetString(provider, "type");
        return BuiltinProviders.Any((builtin) => GetString(builtin, "type") == type);
    }

    private static bool IsEnabled(JsonElement element)
    {
        return !element.TryGetProperty("enabled", out var enabled) || enabled.ValueKind != JsonValueKind.False;
    }

    private static IEnumerable<JsonElement> GetModels(JsonElement provider)
    {
        if (provider.TryGetProperty("defaultModels", out var defaultModels) && defaultModels.ValueKind == JsonValueKind.Array)
        {
            return defaultModels.EnumerateArray();
        }

        if (provider.TryGetProperty("models", out var models) && models.ValueKind == JsonValueKind.Array)
        {
            return models.EnumerateArray();
        }

        return Enumerable.Empty<JsonElement>();
    }

    private static ActiveSelectionResponse EmptySelection() => new(new(string.Empty, string.Empty), new(string.Empty, string.Empty));

    private static string GetString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? string.Empty
            : string.Empty;
    }

    private static JsonElement? GetOptionalElement(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) ? property.Clone() : null;
    }

    private static string NormalizeBaseUrl(string baseUrl)
    {
        var trimmed = baseUrl.Trim();
        if (trimmed.Length == 0)
        {
            return trimmed;
        }

        var withScheme = Regex.IsMatch(trimmed, "^[a-zA-Z][a-zA-Z\\d+.-]*://") ? trimmed : $"https://{trimmed}";
        return withScheme.TrimEnd('/');
    }

    private static JsonElement CreateBuiltinProvider(string id, string type, string name, bool enabled, string baseUrl, string? apiKeyEnv, IReadOnlyList<JsonElement> defaultModels)
    {
        var now = DateTimeOffset.UtcNow.ToString("O");
        var provider = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["type"] = type,
            ["name"] = name,
            ["enabled"] = enabled,
            ["baseUrl"] = baseUrl,
            ["defaultModels"] = defaultModels,
            ["createdAt"] = now,
            ["updatedAt"] = now,
        };

        if (apiKeyEnv is not null)
        {
            provider["apiKeyEnv"] = apiKeyEnv;
        }

        return JsonSerializer.SerializeToElement(provider, JsonOptions);
    }

    private static JsonElement CreateBuiltinModel(
        string id,
        string label,
        bool enabled,
        bool? supportsTools = null,
        bool? supportsVision = null,
        bool? supportsThinking = null,
        decimal? inputPricePerMillion = null,
        decimal? outputPricePerMillion = null)
    {
        var model = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["label"] = label,
            ["enabled"] = enabled,
        };

        if (supportsTools is not null) model["supportsTools"] = supportsTools.Value;
        if (supportsVision is not null) model["supportsVision"] = supportsVision.Value;
        if (supportsThinking is not null) model["supportsThinking"] = supportsThinking.Value;
        if (inputPricePerMillion is not null) model["inputPricePerMillion"] = inputPricePerMillion.Value;
        if (outputPricePerMillion is not null) model["outputPricePerMillion"] = outputPricePerMillion.Value;

        return JsonSerializer.SerializeToElement(model, JsonOptions);
    }
}
