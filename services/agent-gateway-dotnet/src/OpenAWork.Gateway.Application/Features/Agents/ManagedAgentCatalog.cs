using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Application.Features.Capabilities;
using OpenAWork.Gateway.Contracts.Agents;
using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Application.Features.Agents;

internal static partial class ManagedAgentCatalog
{
    private const string AgentCatalogKey = "agent_catalog";
    private const string LegacyAgentPreferencesKey = "agent_preferences";
    private const int MaxCustomAgentsPerUser = 64;
    private static readonly string SystemCreatedAt = ToTsIsoString(DateTimeOffset.UnixEpoch);
    private static readonly StringComparer CultureComparer = StringComparer.Create(CultureInfo.GetCultureInfo("zh-CN"), false);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly IReadOnlyDictionary<string, List<string>> BuiltinModelCandidates = new Dictionary<string, List<string>>
    {
        ["explore"] = ["grok-code-fast-1", "minimax-m2.7-highspeed", "minimax-m2.7", "claude-haiku-4-5", "gpt-5-nano"],
        ["librarian"] = ["minimax-m2.7", "minimax-m2.7-highspeed", "claude-haiku-4-5", "gpt-5-nano"],
        ["oracle"] = ["gpt-5.4", "gemini-3.1-pro", "claude-opus-4-6", "glm-5"],
        ["zeus"] = ["gpt-5.4", "claude-opus-4-6", "glm-5"],
        ["metis"] = ["claude-opus-4-6", "gpt-5.4", "glm-5", "kimi-k2.5"],
        ["momus"] = ["gpt-5.4", "claude-opus-4-6", "gemini-3.1-pro", "glm-5"],
        ["multimodal-looker"] = ["gpt-5.4", "kimi-k2.5", "glm-4.6v", "gpt-5-nano"],
        ["sisyphus-junior"] = ["claude-sonnet-4-6", "kimi-k2.5", "gpt-5.4", "minimax-m2.7", "big-pickle"],
        ["hephaestus"] = ["gpt-5.4"],
        ["prometheus"] = ["claude-opus-4-6", "gpt-5.4", "glm-5", "gemini-3.1-pro"],
        ["atlas"] = ["claude-sonnet-4-6", "kimi-k2.5", "gpt-5.4", "minimax-m2.7"],
    };

    public static async Task<ManagedAgentsResponse> ListAsync(
        string userId,
        IUserSettingsReader userSettingsReader,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        return BuildManagedAgentsResponse(catalog);
    }

    public static async Task<ManagedAgentResponse> CreateAsync(
        string userId,
        CreateManagedAgentCommand request,
        IUserSettingsReader userSettingsReader,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        var body = NormalizeBody(
            label: request.Label,
            description: request.Description,
            aliases: request.Aliases,
            canonicalRole: request.CanonicalRole,
            model: request.Model,
            variant: request.Variant,
            fallbackModels: request.FallbackModels,
            systemPrompt: request.SystemPrompt,
            note: request.Note,
            color: null);

        if (string.IsNullOrWhiteSpace(body.SystemPrompt))
        {
            throw new InvalidOperationException("Custom agent systemPrompt is required");
        }

        if (catalog.CustomAgents.Count >= MaxCustomAgentsPerUser)
        {
            throw new InvalidOperationException($"Managed agent limit reached ({MaxCustomAgentsPerUser})");
        }

        var id = NormalizeOptionalText(request.Id) ?? GenerateCustomAgentId(body.Label, catalog);
        if (BuiltinAgentExists(id) || catalog.CustomAgents.ContainsKey(id))
        {
            throw new InvalidOperationException($"Agent {id} already exists");
        }

        var now = ToTsIsoString(DateTimeOffset.UtcNow);
        catalog.CustomAgents[id] = new StoredCustomAgent
        {
            Id = id,
            Current = body,
            DefaultBody = body.Clone(),
            Enabled = request.Enabled != false,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
        return BuildCustomAgentRecord(catalog.CustomAgents[id]);
    }

    public static async Task<ManagedAgentResponse> UpdateAsync(
        string userId,
        UpdateManagedAgentCommand request,
        IUserSettingsReader userSettingsReader,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        var now = ToTsIsoString(DateTimeOffset.UtcNow);

        if (catalog.CustomAgents.TryGetValue(request.AgentId, out var customAgent))
        {
            customAgent.Current = NormalizeBody(
                label: request.Label ?? customAgent.Current.Label,
                description: request.Description ?? customAgent.Current.Description,
                aliases: request.Aliases ?? customAgent.Current.Aliases,
                canonicalRole: request.CanonicalRole ?? customAgent.Current.CanonicalRole,
                model: request.Model ?? customAgent.Current.Model,
                variant: request.Variant ?? customAgent.Current.Variant,
                fallbackModels: request.FallbackModels ?? customAgent.Current.FallbackModels,
                systemPrompt: request.SystemPrompt ?? customAgent.Current.SystemPrompt,
                note: request.Note ?? customAgent.Current.Note,
                color: customAgent.Current.Color);
            customAgent.Enabled = request.Enabled ?? customAgent.Enabled;
            customAgent.UpdatedAt = now;

            await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
            return BuildCustomAgentRecord(customAgent);
        }

        if (!BuiltinAgentExists(request.AgentId))
        {
            throw new KeyNotFoundException($"Agent {request.AgentId} not found");
        }

        if (request.Label is not null || request.Description is not null || request.Aliases is not null || request.CanonicalRole is not null || request.SystemPrompt is not null || request.Note is not null || request.Enabled is not null)
        {
            throw new InvalidOperationException("Builtin agents only allow model configuration updates");
        }

        var currentOverride = catalog.BuiltinOverrides.GetValueOrDefault(request.AgentId) ?? new StoredBuiltinOverride();
        var nextOverride = new StoredBuiltinOverride
        {
            Model = request.Model is not null ? NormalizeOptionalText(request.Model) : currentOverride.Model,
            Variant = request.Variant is not null ? NormalizeOptionalText(request.Variant) : currentOverride.Variant,
            FallbackModels = request.FallbackModels is not null ? NormalizeModelList(request.FallbackModels) : currentOverride.FallbackModels,
            UpdatedAt = now,
        };

        var defaultBody = DefaultBodyForBuiltin(request.AgentId);
        var sameAsDefault = (nextOverride.Model ?? defaultBody.Model) == defaultBody.Model
            && (nextOverride.Variant ?? defaultBody.Variant) == defaultBody.Variant
            && SequenceEqual(nextOverride.FallbackModels ?? defaultBody.FallbackModels, defaultBody.FallbackModels);

        if (sameAsDefault)
        {
            catalog.BuiltinOverrides.Remove(request.AgentId);
        }
        else
        {
            catalog.BuiltinOverrides[request.AgentId] = nextOverride;
        }

        await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
        return BuildBuiltinAgentRecord(request.AgentId, catalog.BuiltinOverrides.GetValueOrDefault(request.AgentId));
    }

    public static async Task RemoveAsync(
        string userId,
        string agentId,
        IUserSettingsReader userSettingsReader,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        if (catalog.CustomAgents.Remove(agentId))
        {
            await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
            return;
        }

        throw new InvalidOperationException($"Builtin agent {agentId} cannot be removed");
    }

    public static async Task<ManagedAgentResponse> ResetAsync(
        string userId,
        string agentId,
        IUserSettingsReader userSettingsReader,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        if (catalog.CustomAgents.TryGetValue(agentId, out var customAgent))
        {
            customAgent.Current = customAgent.DefaultBody.Clone();
            customAgent.Enabled = true;
            customAgent.UpdatedAt = ToTsIsoString(DateTimeOffset.UtcNow);
            await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
            return BuildCustomAgentRecord(customAgent);
        }

        if (BuiltinAgentExists(agentId))
        {
            catalog.BuiltinOverrides.Remove(agentId);
            await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
            return BuildBuiltinAgentRecord(agentId, null);
        }

        throw new KeyNotFoundException($"Agent {agentId} not found");
    }

    public static async Task<ManagedAgentsResponse> ResetAllAsync(
        string userId,
        IUserSettingsReader userSettingsReader,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var catalog = await LoadStoredCatalogAsync(userId, userSettingsReader, cancellationToken);
        catalog.BuiltinOverrides.Clear();

        foreach (var customAgent in catalog.CustomAgents.Values)
        {
            customAgent.Current = customAgent.DefaultBody.Clone();
            customAgent.Enabled = true;
            customAgent.UpdatedAt = ToTsIsoString(DateTimeOffset.UtcNow);
        }

        await PersistStoredCatalogAsync(userId, catalog, userSettingsWriter, cancellationToken);
        return BuildManagedAgentsResponse(catalog);
    }

    private static async Task<StoredAgentCatalog> LoadStoredCatalogAsync(
        string userId,
        IUserSettingsReader userSettingsReader,
        CancellationToken cancellationToken)
    {
        var catalogRaw = await userSettingsReader.GetValueAsync(userId, AgentCatalogKey, cancellationToken);
        var legacyRaw = await userSettingsReader.GetValueAsync(userId, LegacyAgentPreferencesKey, cancellationToken);
        var catalog = ParseStoredCatalog(catalogRaw);

        foreach (var entry in ParseLegacyPreferences(legacyRaw))
        {
            catalog.BuiltinOverrides.TryAdd(entry.Key, entry.Value);
        }

        return catalog;
    }

    private static Task PersistStoredCatalogAsync(
        string userId,
        StoredAgentCatalog catalog,
        IUserSettingsWriter userSettingsWriter,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(catalog, JsonOptions);
        return userSettingsWriter.UpsertAsync(userId, AgentCatalogKey, payload, cancellationToken);
    }

    private static StoredAgentCatalog ParseStoredCatalog(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new StoredAgentCatalog();
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return new StoredAgentCatalog();
            }

            var catalog = new StoredAgentCatalog();
            var root = document.RootElement;

            if (root.TryGetProperty("builtinOverrides", out var builtinOverridesElement)
                && builtinOverridesElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in builtinOverridesElement.EnumerateObject())
                {
                    if (property.Value.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var overrideValue = ParseBuiltinOverride(property.Value);
                    if (!IsEmptyBuiltinOverride(overrideValue))
                    {
                        catalog.BuiltinOverrides[property.Name] = overrideValue;
                    }
                }
            }

            if (root.TryGetProperty("customAgents", out var customAgentsElement)
                && customAgentsElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in customAgentsElement.EnumerateObject())
                {
                    if (property.Value.ValueKind != JsonValueKind.Object)
                    {
                        continue;
                    }

                    var current = ParseBodyState(property.Value, "current");
                    var defaultBody = ParseBodyState(property.Value, "defaultBody", current);
                    var enabled = !property.Value.TryGetProperty("enabled", out var enabledElement)
                        || enabledElement.ValueKind != JsonValueKind.False;

                    catalog.CustomAgents[property.Name] = new StoredCustomAgent
                    {
                        Id = property.Name,
                        Current = current,
                        DefaultBody = defaultBody,
                        Enabled = enabled,
                        CreatedAt = ReadOptionalString(property.Value, "createdAt") ?? ToTsIsoString(DateTimeOffset.UtcNow),
                        UpdatedAt = ReadOptionalString(property.Value, "updatedAt") ?? ToTsIsoString(DateTimeOffset.UtcNow),
                    };
                }
            }

            return catalog;
        }
        catch (JsonException)
        {
            return new StoredAgentCatalog();
        }
    }

    private static IReadOnlyDictionary<string, StoredBuiltinOverride> ParseLegacyPreferences(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new Dictionary<string, StoredBuiltinOverride>();
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return new Dictionary<string, StoredBuiltinOverride>();
            }

            var result = new Dictionary<string, StoredBuiltinOverride>();
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                var enabled = property.Value.TryGetProperty("hidden", out var hiddenElement) && hiddenElement.ValueKind == JsonValueKind.True
                    ? false
                    : (bool?)null;
                var updatedAt = property.Value.TryGetProperty("updatedAt", out var updatedAtElement) && updatedAtElement.ValueKind == JsonValueKind.String
                    ? updatedAtElement.GetString()
                    : null;

                var overrideValue = new StoredBuiltinOverride
                {
                    Enabled = enabled,
                    UpdatedAt = updatedAt,
                };

                if (overrideValue.Enabled is not null || !string.IsNullOrWhiteSpace(overrideValue.UpdatedAt))
                {
                    result[property.Name] = overrideValue;
                }
            }

            return result;
        }
        catch (JsonException)
        {
            return new Dictionary<string, StoredBuiltinOverride>();
        }
    }

    private static ManagedAgentBodyState DefaultBodyForBuiltin(string agentId)
    {
        var builtin = CapabilityCatalogStaticData.BuiltinAgents.FirstOrDefault((item) => item.Id == agentId)
            ?? throw new KeyNotFoundException($"Unknown builtin agent: {agentId}");
        var modelCandidates = BuiltinModelCandidates.GetValueOrDefault(agentId) ?? [];
        var reference = BuiltinAgentReferenceSnapshot.Data.GetValueOrDefault(agentId);

        return NormalizeBody(
            label: builtin.Label,
            description: reference?.Description ?? builtin.Description,
            aliases: builtin.Aliases ?? [],
            canonicalRole: builtin.CanonicalRole,
            model: modelCandidates.FirstOrDefault(),
            variant: null,
            fallbackModels: modelCandidates.Skip(1).ToArray(),
            systemPrompt: reference?.SystemPrompt,
            note: null,
            color: null);
    }

    private static ManagedAgentsResponse BuildManagedAgentsResponse(StoredAgentCatalog catalog)
    {
        var agents = CapabilityCatalogStaticData.BuiltinAgents
            .Select((agent) => BuildBuiltinAgentRecord(agent.Id, catalog.BuiltinOverrides.GetValueOrDefault(agent.Id)))
            .Concat(catalog.CustomAgents.Values.Select(BuildCustomAgentRecord))
            .OrderByDescending((agent) => agent.Origin == "builtin")
            .ThenBy((agent) => agent.Label, CultureComparer)
            .ToArray();

        return new ManagedAgentsResponse(agents);
    }

    private static ManagedAgentResponse BuildBuiltinAgentRecord(string agentId, StoredBuiltinOverride? overrideValue)
    {
        var builtin = CapabilityCatalogStaticData.BuiltinAgents.First((item) => item.Id == agentId);
        var defaultBody = DefaultBodyForBuiltin(agentId);
        var currentBody = NormalizeBody(
            label: defaultBody.Label,
            description: defaultBody.Description,
            aliases: defaultBody.Aliases,
            canonicalRole: defaultBody.CanonicalRole,
            model: overrideValue?.Model ?? defaultBody.Model,
            variant: overrideValue?.Variant ?? defaultBody.Variant,
            fallbackModels: overrideValue?.FallbackModels ?? defaultBody.FallbackModels,
            systemPrompt: defaultBody.SystemPrompt,
            note: defaultBody.Note,
            color: defaultBody.Color);

        var hasModelOverrides = (overrideValue?.Model ?? defaultBody.Model) != defaultBody.Model
            || (overrideValue?.Variant ?? defaultBody.Variant) != defaultBody.Variant
            || !SequenceEqual(overrideValue?.FallbackModels ?? defaultBody.FallbackModels, defaultBody.FallbackModels);

        return new ManagedAgentResponse(
            Id: agentId,
            Origin: "builtin",
            Source: builtin.Source,
            Enabled: overrideValue?.Enabled ?? true,
            Removable: false,
            Resettable: hasModelOverrides,
            HasOverrides: hasModelOverrides,
            CreatedAt: SystemCreatedAt,
            UpdatedAt: overrideValue?.UpdatedAt ?? SystemCreatedAt,
            Label: currentBody.Label,
            Description: currentBody.Description,
            Aliases: currentBody.Aliases,
            CanonicalRole: currentBody.CanonicalRole,
            Model: currentBody.Model,
            Variant: currentBody.Variant,
            FallbackModels: currentBody.FallbackModels,
            SystemPrompt: currentBody.SystemPrompt,
            Color: currentBody.Color,
            Note: currentBody.Note);
    }

    private static ManagedAgentResponse BuildCustomAgentRecord(StoredCustomAgent agent)
    {
        var bodyChanged = !BodiesEqual(agent.Current, agent.DefaultBody);
        return new ManagedAgentResponse(
            Id: agent.Id,
            Origin: "custom",
            Source: "custom",
            Enabled: agent.Enabled,
            Removable: true,
            Resettable: !agent.Enabled || bodyChanged,
            HasOverrides: bodyChanged || !agent.Enabled,
            CreatedAt: agent.CreatedAt,
            UpdatedAt: agent.UpdatedAt,
            Label: agent.Current.Label,
            Description: agent.Current.Description,
            Aliases: agent.Current.Aliases,
            CanonicalRole: agent.Current.CanonicalRole,
            Model: agent.Current.Model,
            Variant: agent.Current.Variant,
            FallbackModels: agent.Current.FallbackModels,
            SystemPrompt: agent.Current.SystemPrompt,
            Color: agent.Current.Color,
            Note: agent.Current.Note);
    }

    private static bool BodiesEqual(ManagedAgentBodyState left, ManagedAgentBodyState right)
    {
        return left.Label == right.Label
            && left.Description == right.Description
            && SequenceEqual(left.Aliases, right.Aliases)
            && CanonicalRolesEqual(left.CanonicalRole, right.CanonicalRole)
            && left.Model == right.Model
            && left.Variant == right.Variant
            && SequenceEqual(left.FallbackModels, right.FallbackModels)
            && left.SystemPrompt == right.SystemPrompt
            && left.Color == right.Color
            && left.Note == right.Note;
    }

    private static bool CanonicalRolesEqual(CanonicalRoleResponse? left, CanonicalRoleResponse? right)
    {
        if (left is null && right is null)
        {
            return true;
        }

        if (left is null || right is null)
        {
            return false;
        }

        return left.CoreRole == right.CoreRole
            && left.Preset == right.Preset
            && left.Confidence == right.Confidence
            && SequenceEqual(left.Overlays, right.Overlays);
    }

    private static bool SequenceEqual(IReadOnlyList<string>? left, IReadOnlyList<string>? right)
    {
        if (left is null && right is null)
        {
            return true;
        }

        if (left is null || right is null || left.Count != right.Count)
        {
            return false;
        }

        for (var index = 0; index < left.Count; index++)
        {
            if (!string.Equals(left[index], right[index], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static ManagedAgentBodyState NormalizeBody(
        string label,
        string description,
        IReadOnlyList<string> aliases,
        CanonicalRoleResponse? canonicalRole,
        string? model,
        string? variant,
        IReadOnlyList<string> fallbackModels,
        string? systemPrompt,
        string? note,
        string? color)
    {
        return new ManagedAgentBodyState
        {
            Label = NormalizeOptionalText(label) ?? "未命名 Agent",
            Description = NormalizeOptionalText(description) ?? string.Empty,
            Aliases = NormalizeAliasList(aliases),
            CanonicalRole = NormalizeCanonicalRole(canonicalRole),
            Model = NormalizeOptionalText(model),
            Variant = NormalizeOptionalText(variant),
            FallbackModels = NormalizeModelList(fallbackModels),
            SystemPrompt = NormalizeOptionalText(systemPrompt),
            Color = NormalizeOptionalText(color),
            Note = NormalizeOptionalText(note),
        };
    }

    private static ManagedAgentBodyState NormalizeBodyState(ManagedAgentBodyState? state)
    {
        if (state is null)
        {
            return NormalizeBody(string.Empty, string.Empty, [], null, null, null, [], null, null, null);
        }

        return NormalizeBody(
            state.Label,
            state.Description,
            state.Aliases,
            state.CanonicalRole,
            state.Model,
            state.Variant,
            state.FallbackModels,
            state.SystemPrompt,
            state.Note,
            state.Color);
    }

    private static CanonicalRoleResponse? NormalizeCanonicalRole(CanonicalRoleResponse? value)
    {
        if (value is null || string.IsNullOrWhiteSpace(value.CoreRole))
        {
            return null;
        }

        return new CanonicalRoleResponse(
            CoreRole: value.CoreRole,
            Preset: NormalizeOptionalText(value.Preset),
            Overlays: NormalizeAliasList(value.Overlays ?? []),
            Confidence: NormalizeOptionalText(value.Confidence));
    }

    private static List<string> NormalizeAliasList(IReadOnlyList<string> values)
    {
        return values
            .Select(NormalizeOptionalText)
            .Where((value) => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Cast<string>()
            .ToList();
    }

    private static List<string> NormalizeModelList(IReadOnlyList<string> values)
    {
        return values
            .Select(NormalizeOptionalText)
            .Where((value) => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Cast<string>()
            .ToList();
    }

    private static string? NormalizeOptionalText(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }

    private static string? ReadOptionalString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? NormalizeOptionalText(property.GetString())
            : null;

    private static StoredBuiltinOverride ParseBuiltinOverride(JsonElement element)
    {
        return new StoredBuiltinOverride
        {
            Model = ReadOptionalString(element, "model"),
            Variant = ReadOptionalString(element, "variant"),
            FallbackModels = ReadOptionalStringArray(element, "fallbackModels"),
            Enabled = element.TryGetProperty("enabled", out var enabledElement)
                ? enabledElement.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    _ => null,
                }
                : null,
            UpdatedAt = ReadOptionalString(element, "updatedAt"),
        };
    }

    private static ManagedAgentBodyState ParseBodyState(
        JsonElement element,
        string propertyName,
        ManagedAgentBodyState? fallback = null)
    {
        if (!element.TryGetProperty(propertyName, out var bodyElement) || bodyElement.ValueKind != JsonValueKind.Object)
        {
            return fallback?.Clone() ?? NormalizeBody(string.Empty, string.Empty, [], null, null, null, [], null, null, null);
        }

        var aliases = ReadOptionalStringArray(bodyElement, "aliases") ?? fallback?.Aliases ?? [];
        var fallbackModels = ReadOptionalStringArray(bodyElement, "fallbackModels") ?? fallback?.FallbackModels ?? [];
        var canonicalRole = ParseCanonicalRole(bodyElement.TryGetProperty("canonicalRole", out var canonicalRoleElement)
            ? canonicalRoleElement
            : default,
            fallback?.CanonicalRole);

        return NormalizeBody(
            label: ReadOptionalString(bodyElement, "label") ?? fallback?.Label ?? string.Empty,
            description: ReadOptionalString(bodyElement, "description") ?? fallback?.Description ?? string.Empty,
            aliases: aliases,
            canonicalRole: canonicalRole,
            model: ReadOptionalString(bodyElement, "model") ?? fallback?.Model,
            variant: ReadOptionalString(bodyElement, "variant") ?? fallback?.Variant,
            fallbackModels: fallbackModels,
            systemPrompt: ReadOptionalString(bodyElement, "systemPrompt") ?? fallback?.SystemPrompt,
            note: ReadOptionalString(bodyElement, "note") ?? fallback?.Note,
            color: ReadOptionalString(bodyElement, "color") ?? fallback?.Color);
    }

    private static CanonicalRoleResponse? ParseCanonicalRole(JsonElement element, CanonicalRoleResponse? fallback)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return fallback;
        }

        var coreRole = ReadOptionalString(element, "coreRole") ?? fallback?.CoreRole;
        if (string.IsNullOrWhiteSpace(coreRole))
        {
            return fallback;
        }

        var overlays = (ReadOptionalStringArray(element, "overlays") ?? fallback?.Overlays)
            ?.Where((item) => item is "writer" or "multimodal")
            .ToArray();
        var confidence = ReadOptionalString(element, "confidence");
        if (confidence is not ("low" or "medium" or "high"))
        {
            confidence = fallback?.Confidence;
        }

        return NormalizeCanonicalRole(new CanonicalRoleResponse(
            coreRole,
            ReadOptionalString(element, "preset") ?? fallback?.Preset,
            overlays,
            confidence));
    }

    private static List<string>? ReadOptionalStringArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var arrayElement) || arrayElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        return arrayElement.EnumerateArray()
            .Where((item) => item.ValueKind == JsonValueKind.String)
            .Select((item) => NormalizeOptionalText(item.GetString()))
            .Where((item) => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.Ordinal)
            .Cast<string>()
            .ToList();
    }

    private static bool IsEmptyBuiltinOverride(StoredBuiltinOverride overrideValue)
    {
        return overrideValue.Enabled is null
            && string.IsNullOrWhiteSpace(overrideValue.Model)
            && string.IsNullOrWhiteSpace(overrideValue.Variant)
            && (overrideValue.FallbackModels is null || overrideValue.FallbackModels.Count == 0)
            && string.IsNullOrWhiteSpace(overrideValue.UpdatedAt);
    }

    private static string ToTsIsoString(DateTimeOffset value)
        => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static string GenerateCustomAgentId(string label, StoredAgentCatalog catalog)
    {
        var baseId = AgentIdRegex().Replace(label.ToLowerInvariant(), "-").Trim('-');
        if (string.IsNullOrWhiteSpace(baseId))
        {
            baseId = $"agent-{Guid.NewGuid():N}"[..14];
        }
        else if (baseId.Length > 40)
        {
            baseId = baseId[..40].Trim('-');
        }

        var candidate = baseId;
        var index = 1;
        while (BuiltinAgentExists(candidate) || catalog.CustomAgents.ContainsKey(candidate))
        {
            candidate = $"{baseId}-{index}";
            index += 1;
        }

        return candidate;
    }

    private static bool BuiltinAgentExists(string agentId)
        => CapabilityCatalogStaticData.BuiltinAgents.Any((item) => item.Id == agentId);

    [GeneratedRegex("[^a-z0-9]+", RegexOptions.Compiled)]
    private static partial Regex AgentIdRegex();

    private sealed class StoredAgentCatalog
    {
        public Dictionary<string, StoredBuiltinOverride> BuiltinOverrides { get; set; } = [];

        public Dictionary<string, StoredCustomAgent> CustomAgents { get; set; } = [];
    }

    private sealed class StoredBuiltinOverride
    {
        public string? Model { get; set; }

        public string? Variant { get; set; }

        public List<string>? FallbackModels { get; set; }

        public bool? Enabled { get; set; }

        public string? UpdatedAt { get; set; }
    }

    private sealed class StoredCustomAgent
    {
        public required string Id { get; set; }

        public required ManagedAgentBodyState Current { get; set; }

        public required ManagedAgentBodyState DefaultBody { get; set; }

        public bool Enabled { get; set; }

        public required string CreatedAt { get; set; }

        public required string UpdatedAt { get; set; }
    }

    private sealed class ManagedAgentBodyState
    {
        public string Label { get; set; } = string.Empty;

        public string Description { get; set; } = string.Empty;

        public List<string> Aliases { get; set; } = [];

        public CanonicalRoleResponse? CanonicalRole { get; set; }

        public string? Model { get; set; }

        public string? Variant { get; set; }

        public List<string> FallbackModels { get; set; } = [];

        public string? SystemPrompt { get; set; }

        public string? Color { get; set; }

        public string? Note { get; set; }

        public ManagedAgentBodyState Clone()
        {
            return new ManagedAgentBodyState
            {
                Label = Label,
                Description = Description,
                Aliases = [.. Aliases],
                CanonicalRole = CanonicalRole is null
                    ? null
                    : new CanonicalRoleResponse(CanonicalRole.CoreRole, CanonicalRole.Preset, CanonicalRole.Overlays is null ? null : [.. CanonicalRole.Overlays], CanonicalRole.Confidence),
                Model = Model,
                Variant = Variant,
                FallbackModels = [.. FallbackModels],
                SystemPrompt = SystemPrompt,
                Color = Color,
                Note = Note,
            };
        }
    }
}
