using System.Text.Json;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public static class CompanionSettingsSupport
{
    internal const string SettingsKey = "companion_preferences_v1";
    private static readonly HashSet<string> ValidInjectionModes = ["off", "mention_only", "always"];
    private static readonly HashSet<string> ValidVerbosity = ["minimal", "normal"];
    private static readonly HashSet<string> ValidThemeVariants = ["default", "playful"];
    private static readonly HashSet<string> ValidBehaviorTones = ["supportive", "focused", "playful"];
    private static readonly HashSet<string> ValidVoiceOutputModes = ["off", "buddy_only", "important_only"];
    private static readonly HashSet<string> ValidVoiceVariants = ["system", "bright", "calm"];
    private static readonly HashSet<string> ValidSpecies = ["duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin", "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot", "rabbit", "mushroom", "chonk"];
    private static readonly string[] SpriteEyes = ["·", "✦", "×", "◉", "@", "°"];
    private static readonly string[] SpriteHats = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"];
    private static readonly string[] CompanionNames = ["雾灯", "回声", "稜镜", "潮汐", "灰羽", "柏舟", "松针", "折光"];
    private static readonly string[] CompanionArchetypes = ["低打扰观察员", "节奏记录者", "上下文伴读者", "边栏巡航员", "静默副屏同伴", "工作台回声体"];
    private static readonly string[] CompanionGlyphs = ["✦", "◐", "◒", "✷", "◍", "◇", "◈", "✧"];
    private static readonly string[] CompanionNotes = ["只在你需要时露面，不抢主助手的话筒。", "擅长贴着输入节奏给出轻声反馈。", "偏爱把复杂过程压成一句安静提示。", "更像工作台里的第二道呼吸，而不是第二个助手。"];
    private static readonly string[][] CompanionTraitSets = [["低打扰", "看输入", "贴着节奏"], ["看附件", "看队列", "不抢前景"], ["看运行态", "看待办", "轻量提醒"], ["跟侧栏", "跟命令", "跟上下文"]];
    private static readonly Dictionary<string, string> SpeciesLabels = new()
    {
        ["duck"] = "小鸭",
        ["goose"] = "白鹅",
        ["blob"] = "软团",
        ["cat"] = "夜猫",
        ["dragon"] = "幼龙",
        ["octopus"] = "章鱼",
        ["owl"] = "猫头鹰",
        ["penguin"] = "企鹅",
        ["turtle"] = "海龟",
        ["snail"] = "蜗牛",
        ["ghost"] = "幽灵",
        ["axolotl"] = "六角恐龙",
        ["capybara"] = "水豚",
        ["cactus"] = "仙人掌",
        ["robot"] = "机械体",
        ["rabbit"] = "兔子",
        ["mushroom"] = "蘑菇",
        ["chonk"] = "团子兽",
    };
    private static readonly Dictionary<string, int> RarityWeights = new()
    {
        ["common"] = 60,
        ["uncommon"] = 25,
        ["rare"] = 10,
        ["epic"] = 4,
        ["legendary"] = 1,
    };
    private static readonly Dictionary<string, string> RarityStars = new()
    {
        ["common"] = "★",
        ["uncommon"] = "★★",
        ["rare"] = "★★★",
        ["epic"] = "★★★★",
        ["legendary"] = "★★★★★",
    };
    private static readonly Dictionary<string, string> ToneArchetypes = new()
    {
        ["supportive"] = "安抚型陪跑者",
        ["focused"] = "聚焦型执行伴侣",
        ["playful"] = "轻快型工作台搭子",
    };
    private static readonly Dictionary<string, string> ToneNotes = new()
    {
        ["supportive"] = "更关注稳定情绪和节奏托底，会优先给出柔和但明确的提醒。",
        ["focused"] = "偏向把干扰压低，只保留最短路径的执行提示与任务推进感。",
        ["playful"] = "语气更轻松，允许在不抢主线的前提下给出一点玩笑和活力。",
    };
    private static readonly Dictionary<string, string> ToneTags = new()
    {
        ["supportive"] = "情绪托底",
        ["focused"] = "执行优先",
        ["playful"] = "轻快互动",
    };

    internal static readonly CompanionPreferencesResponse DefaultPreferences = new(
        true, false, false, "normal", "mention_only", "default", false, "buddy_only", 1.02, "system");

    internal static CompanionSettingsState Load(string? storedValue, string userEmail, string? agentId)
    {
        IReadOnlyDictionary<string, CompanionAgentBindingResponse> bindings = new Dictionary<string, CompanionAgentBindingResponse>(StringComparer.Ordinal);
        var preferences = DefaultPreferences;
        string? updatedAt = null;

        if (!string.IsNullOrWhiteSpace(storedValue))
        {
            try
            {
                using var document = JsonDocument.Parse(storedValue);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    if (document.RootElement.TryGetProperty("bindings", out var bindingsElement) && bindingsElement.ValueKind == JsonValueKind.Object)
                    {
                        bindings = ParseBindings(bindingsElement);
                    }

                    if (document.RootElement.TryGetProperty("preferences", out var preferencesElement) && preferencesElement.ValueKind == JsonValueKind.Object)
                    {
                        preferences = ParsePreferences(preferencesElement, DefaultPreferences);
                    }

                    if (document.RootElement.TryGetProperty("updatedAt", out var updatedAtElement) && updatedAtElement.ValueKind == JsonValueKind.String)
                    {
                        updatedAt = updatedAtElement.GetString();
                    }
                }
            }
            catch (JsonException)
            {
            }
        }

        var normalizedAgentId = NormalizeAgentId(agentId);
        bindings.TryGetValue(normalizedAgentId ?? string.Empty, out var activeBinding);
        var profile = ResolveProfileForAgent(userEmail, normalizedAgentId, bindings, preferences);

        return new CompanionSettingsState(bindings, preferences, activeBinding, profile, updatedAt);
    }

    internal static CompanionSettingsState MergeUpdate(CompanionSettingsState existing, CompanionSettingsUpdate update, string userEmail, string? agentId)
    {
        var bindings = update.Bindings ?? existing.Bindings;
        var preferences = MergePreferences(existing.Preferences, update.Preferences);
        var normalizedAgentId = NormalizeAgentId(agentId);
        bindings.TryGetValue(normalizedAgentId ?? string.Empty, out var activeBinding);
        var profile = ResolveProfileForAgent(userEmail, normalizedAgentId, bindings, preferences);
        return new CompanionSettingsState(bindings, preferences, activeBinding, profile, DateTimeOffset.UtcNow.ToString("O"));
    }

    internal static object BuildStoredPayload(CompanionSettingsState state) => new
    {
        bindings = state.Bindings,
        preferences = state.Preferences,
        profile = state.Profile,
        updatedAt = state.UpdatedAt ?? DateTimeOffset.UtcNow.ToString("O"),
    };

    internal static CompanionFeatureStateResponse BuildFeatureState(CompanionPreferencesResponse preferences) =>
        preferences.Enabled ? new CompanionFeatureStateResponse(true, "beta") : new CompanionFeatureStateResponse(false, "off");

    internal static string BuildIntroText(CompanionProfileResponse profile)
        => $"{profile.Name} 会以一只{profile.Species}的身份坐在输入框旁边轻声陪跑。除非你点名，不然我会把话让给主助手。";

    internal static string? BuildChatPrompt(CompanionSettingsState settings, CompanionChatRequest request)
    {
        if (!settings.Preferences.Enabled)
        {
            return null;
        }

        var contextParts = new List<string>();
        if (request.Context is not null)
        {
            var ctx = request.Context;
            if (ctx.SessionBusy == true) contextParts.Add("当前会话正在运行中");
            if (ctx.PendingApprovals > 0) contextParts.Add($"{ctx.PendingApprovals} 个待审批项");
            if (ctx.PendingQuestions > 0) contextParts.Add($"{ctx.PendingQuestions} 个待回答问题");
            if (ctx.RunningTasks > 0) contextParts.Add($"{ctx.RunningTasks} 个正在运行的任务");
            if (ctx.BlockedTasks > 0) contextParts.Add($"{ctx.BlockedTasks} 个被阻塞的任务");
            if (ctx.TodoCount > 0) contextParts.Add($"{ctx.TodoCount} 个待办事项");
        }

        var contextBlock = contextParts.Count > 0
            ? "\n\n当前工作台状态：\n" + string.Join("\n", contextParts.Select((part) => $"- {part}"))
            : string.Empty;

        return $"你是 {settings.Profile.Name}，一个 OpenAWork 工作台的低打扰陪跑 companion。\n\n角色设定：\n{BuildIntroText(settings.Profile)}\n{settings.Profile.Name} 的定位：{settings.Profile.Archetype}。\n行为基调：{settings.Profile.Note}。\n关注标签：{string.Join(" / ", settings.Profile.Traits)}。\n\n你的行为准则：\n1. 保持极短、低打扰，不主动展开，不抢主助手的话筒\n2. 只在必要时补充轻量提醒、节奏反馈或陪伴式短句\n3. 语气要贴合你的角色设定，但不要过度表演\n4. 不要重复用户已经知道的信息\n5. 用中文回复，控制在 40 字以内{contextBlock}\n\n用户对你说：{request.Message}\n\n请以 {settings.Profile.Name} 的身份简短回复：";
    }

    public static bool TryParseSettingsUpdate(JsonElement body, out CompanionSettingsUpdate update, out List<object> issues)
    {
        issues = [];
        update = new CompanionSettingsUpdate(null, null);
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeKind(body.ValueKind), "Invalid companion settings"));
            return false;
        }

        IReadOnlyDictionary<string, CompanionAgentBindingResponse>? bindings = null;
        CompanionPreferencesPartial? preferences = null;

        if (body.TryGetProperty("bindings", out var bindingsElement))
        {
            if (bindingsElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "bindings" }, "object", DescribeKind(bindingsElement.ValueKind), "Invalid companion settings"));
            }
            else
            {
                bindings = ParseBindings(bindingsElement, issues);
            }
        }

        if (body.TryGetProperty("preferences", out var preferencesElement))
        {
            if (preferencesElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "preferences" }, "object", DescribeKind(preferencesElement.ValueKind), "Invalid companion settings"));
            }
            else
            {
                preferences = ParsePreferencesPartial(preferencesElement, issues);
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        update = new CompanionSettingsUpdate(bindings, preferences);
        return true;
    }

    public static bool TryParseChatRequest(JsonElement body, out CompanionChatRequest request, out List<object> issues)
    {
        request = new CompanionChatRequest(string.Empty, null, null, null, null, "gpt-4o");
        issues = [];
        if (body.ValueKind != JsonValueKind.Object)
        {
            issues.Add(CreateInvalidTypeIssue(Array.Empty<string>(), "object", DescribeKind(body.ValueKind), "Invalid input"));
            return false;
        }

        var message = body.TryGetProperty("message", out var messageElement) && messageElement.ValueKind == JsonValueKind.String
            ? messageElement.GetString() ?? string.Empty
            : string.Empty;
        if (message.Length == 0 || message.Length > 2000)
        {
            issues.Add(new { code = "invalid_message", path = new[] { "message" }, message = "Invalid input" });
        }

        string? agentId = null;
        if (body.TryGetProperty("agentId", out var agentElement))
        {
            if (agentElement.ValueKind != JsonValueKind.String)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "agentId" }, "string", DescribeKind(agentElement.ValueKind), "Invalid input"));
            }
            else
            {
                agentId = NormalizeAgentId(agentElement.GetString());
            }
        }

        CompanionChatContext? context = null;
        if (body.TryGetProperty("context", out var contextElement))
        {
            if (contextElement.ValueKind != JsonValueKind.Object)
            {
                issues.Add(CreateInvalidTypeIssue(new[] { "context" }, "object", DescribeKind(contextElement.ValueKind), "Invalid input"));
            }
            else
            {
                context = new CompanionChatContext(
                    ReadOptionalBoolean(contextElement, "sessionBusy"),
                    ReadOptionalInt(contextElement, "pendingApprovals"),
                    ReadOptionalInt(contextElement, "pendingQuestions"),
                    ReadOptionalInt(contextElement, "runningTasks"),
                    ReadOptionalInt(contextElement, "blockedTasks"),
                    ReadOptionalInt(contextElement, "todoCount"));
            }
        }

        if (issues.Count > 0)
        {
            return false;
        }

        request = new CompanionChatRequest(message, context, agentId, null, null, "gpt-4o");
        return true;
    }

    private static IReadOnlyDictionary<string, CompanionAgentBindingResponse> ParseBindings(JsonElement element)
        => ParseBindings(element, []);

    private static IReadOnlyDictionary<string, CompanionAgentBindingResponse> ParseBindings(JsonElement element, List<object> issues)
    {
        var bindings = new Dictionary<string, CompanionAgentBindingResponse>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            var normalizedAgentId = NormalizeAgentId(property.Name);
            if (normalizedAgentId is null || property.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (TryParseBinding(property.Value, out var binding, out var bindingIssues))
            {
                bindings[normalizedAgentId] = binding!;
            }
            else
            {
                issues.AddRange(bindingIssues);
            }
        }

        return bindings;
    }

    private static bool TryParseBinding(JsonElement element, out CompanionAgentBindingResponse? binding, out List<object> issues)
    {
        issues = [];
        binding = null;

        var species = ReadRequiredEnum(element, "species", ValidSpecies, issues);
        var displayName = ReadOptionalTrimmedString(element, "displayName", 40, issues);
        var themeVariant = ReadOptionalEnum(element, "themeVariant", ValidThemeVariants, issues);
        var behaviorTone = ReadOptionalEnum(element, "behaviorTone", ValidBehaviorTones, issues);
        var injectionMode = ReadOptionalEnum(element, "injectionMode", ValidInjectionModes, issues);
        var verbosity = ReadOptionalEnum(element, "verbosity", ValidVerbosity, issues);
        var voiceOutputMode = ReadOptionalEnum(element, "voiceOutputMode", ValidVoiceOutputModes, issues);
        var voiceRate = ReadOptionalDouble(element, "voiceRate", 0.5, 2.0, issues);
        var voiceVariant = ReadOptionalEnum(element, "voiceVariant", ValidVoiceVariants, issues);

        if (issues.Count > 0 || species is null)
        {
            return false;
        }

        binding = new CompanionAgentBindingResponse(displayName, species, themeVariant, behaviorTone, injectionMode, verbosity, voiceOutputMode, voiceRate, voiceVariant);
        return true;
    }

    private static CompanionPreferencesResponse ParsePreferences(JsonElement element, CompanionPreferencesResponse fallback)
    {
        return new CompanionPreferencesResponse(
            ReadOptionalBoolean(element, "enabled") ?? fallback.Enabled,
            ReadOptionalBoolean(element, "muted") ?? fallback.Muted,
            ReadOptionalBoolean(element, "reducedMotion") ?? fallback.ReducedMotion,
            ReadOptionalEnum(element, "verbosity", ValidVerbosity) ?? fallback.Verbosity,
            ReadOptionalEnum(element, "injectionMode", ValidInjectionModes) ?? fallback.InjectionMode,
            ReadOptionalEnum(element, "themeVariant", ValidThemeVariants) ?? fallback.ThemeVariant,
            ReadOptionalBoolean(element, "voiceOutputEnabled") ?? fallback.VoiceOutputEnabled,
            ReadOptionalEnum(element, "voiceOutputMode", ValidVoiceOutputModes) ?? fallback.VoiceOutputMode,
            ReadOptionalDouble(element, "voiceRate", 0.5, 2.0) ?? fallback.VoiceRate,
            ReadOptionalEnum(element, "voiceVariant", ValidVoiceVariants) ?? fallback.VoiceVariant);
    }

    private static CompanionPreferencesPartial ParsePreferencesPartial(JsonElement element, List<object> issues)
    {
        return new CompanionPreferencesPartial(
            ReadOptionalBoolean(element, "enabled"),
            ReadOptionalBoolean(element, "muted"),
            ReadOptionalBoolean(element, "reducedMotion"),
            ReadOptionalEnum(element, "verbosity", ValidVerbosity, issues),
            ReadOptionalEnum(element, "injectionMode", ValidInjectionModes, issues),
            ReadOptionalEnum(element, "themeVariant", ValidThemeVariants, issues),
            ReadOptionalBoolean(element, "voiceOutputEnabled"),
            ReadOptionalEnum(element, "voiceOutputMode", ValidVoiceOutputModes, issues),
            ReadOptionalDouble(element, "voiceRate", 0.5, 2.0, issues),
            ReadOptionalEnum(element, "voiceVariant", ValidVoiceVariants, issues));
    }

    private static CompanionPreferencesResponse MergePreferences(CompanionPreferencesResponse current, CompanionPreferencesPartial? update)
    {
        if (update is null)
        {
            return current;
        }

        return new CompanionPreferencesResponse(
            update.Enabled ?? current.Enabled,
            update.Muted ?? current.Muted,
            update.ReducedMotion ?? current.ReducedMotion,
            update.Verbosity ?? current.Verbosity,
            update.InjectionMode ?? current.InjectionMode,
            update.ThemeVariant ?? current.ThemeVariant,
            update.VoiceOutputEnabled ?? current.VoiceOutputEnabled,
            update.VoiceOutputMode ?? current.VoiceOutputMode,
            update.VoiceRate ?? current.VoiceRate,
            update.VoiceVariant ?? current.VoiceVariant);
    }

    private static CompanionProfileResponse ResolveProfileForAgent(string userEmail, string? agentId, IReadOnlyDictionary<string, CompanionAgentBindingResponse> bindings, CompanionPreferencesResponse preferences)
    {
        bindings.TryGetValue(agentId ?? string.Empty, out var binding);
        var themeVariant = binding?.ThemeVariant ?? preferences.ThemeVariant;
        var seedInput = binding is not null && agentId is not null
            ? $"{userEmail.Trim().ToLowerInvariant()}:{agentId}"
            : userEmail;
        return CreateProfile(seedInput, themeVariant, binding?.BehaviorTone, binding?.DisplayName, binding?.Species);
    }

    private static CompanionProfileResponse CreateProfile(string seedInput, string themeVariant, string? behaviorTone, string? displayName, string? speciesOverride)
    {
        var normalizedSeed = string.IsNullOrWhiteSpace(seedInput) ? "guest" : seedInput.Trim().ToLowerInvariant();
        var seed = HashString(normalizedSeed);
        var random = CreateMulberry32(seed ^ 0x6d2b79f5);
        var species = speciesOverride ?? Pick(SpriteSpeciesArray(), random);
        var rarity = RollRarity(random);
        var toneTag = behaviorTone is not null && ToneTags.TryGetValue(behaviorTone, out var tag) ? tag : null;
        var traits = Pick(CompanionTraitSets, seed, 4).ToList();
        if (toneTag is not null)
        {
            traits.Insert(0, toneTag);
        }

        return new CompanionProfileResponse(
            AccentColor: themeVariant == "playful" ? "#f59e0b" : "#7c3aed",
            AccentTint: themeVariant == "playful" ? "rgba(245,158,11,0.16)" : "rgba(124,58,237,0.16)",
            Archetype: behaviorTone is not null && ToneArchetypes.TryGetValue(behaviorTone, out var archetype) ? archetype : Pick(CompanionArchetypes, seed, 3),
            Glyph: Pick(CompanionGlyphs, seed, 5),
            Name: string.IsNullOrWhiteSpace(displayName) ? Pick(CompanionNames, seed, 0) : displayName!.Trim(),
            Note: behaviorTone is not null && ToneNotes.TryGetValue(behaviorTone, out var note) ? note : Pick(CompanionNotes, seed, 7),
            RarityStars: RarityStars[rarity],
            Species: SpeciesLabels[species],
            Sprite: new CompanionSpriteResponse(Pick(SpriteEyes, random), rarity == "common" ? "none" : Pick(SpriteHats, random), rarity, random() < 0.01, species),
            Traits: traits);
    }

    private static string? NormalizeAgentId(string? agentId)
    {
        if (string.IsNullOrWhiteSpace(agentId))
        {
            return null;
        }

        var normalized = agentId.Trim();
        return normalized.Length == 0 ? null : normalized;
    }

    private static string[] SpriteSpeciesArray() => [.. ValidSpecies];

    private static string RollRarity(Func<double> random)
    {
        var total = RarityWeights.Values.Sum();
        var roll = random() * total;
        foreach (var entry in RarityWeights)
        {
            roll -= entry.Value;
            if (roll < 0)
            {
                return entry.Key;
            }
        }

        return "common";
    }

    private static uint HashString(string value)
    {
        uint hash = 2166136261;
        foreach (var character in value)
        {
            hash ^= character;
            hash *= 16777619;
        }

        return hash;
    }

    private static Func<double> CreateMulberry32(uint seed)
    {
        uint value = seed;
        return () =>
        {
            value += 0x6d2b79f5;
            var next = value;
            next = (uint)((next ^ (next >> 15)) * (1 | next));
            next ^= next + (uint)((next ^ (next >> 7)) * (61 | next));
            return ((next ^ (next >> 14)) & 0xffffffff) / 4294967296.0;
        };
    }

    private static T Pick<T>(IReadOnlyList<T> values, Func<double> random)
        => values[(int)Math.Floor(random() * values.Count)]!;

    private static T Pick<T>(IReadOnlyList<T> values, uint seed, int offset)
        => values[(int)((seed + (uint)offset) % values.Count)]!;

    private static string? ReadOptionalEnum(JsonElement element, string propertyName, HashSet<string> allowed)
        => ReadOptionalEnum(element, propertyName, allowed, null);

    private static string? ReadOptionalEnum(JsonElement element, string propertyName, HashSet<string> allowed, List<object>? issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind != JsonValueKind.String || !allowed.Contains(property.GetString() ?? string.Empty))
        {
            issues?.Add(new { code = "invalid_enum_value", path = new[] { propertyName }, message = "Invalid companion settings" });
            return null;
        }

        return property.GetString();
    }

    private static string? ReadRequiredEnum(JsonElement element, string propertyName, HashSet<string> allowed, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String || !allowed.Contains(property.GetString() ?? string.Empty))
        {
            issues.Add(new { code = "invalid_enum_value", path = new[] { propertyName }, message = "Invalid companion settings" });
            return null;
        }

        return property.GetString();
    }

    private static string? ReadOptionalTrimmedString(JsonElement element, string propertyName, int maxLength, List<object> issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind != JsonValueKind.String)
        {
            issues.Add(new { code = "invalid_type", path = new[] { propertyName }, message = "Invalid companion settings" });
            return null;
        }

        var value = property.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(value) || value.Length > maxLength)
        {
            issues.Add(new { code = "invalid_string", path = new[] { propertyName }, message = "Invalid companion settings" });
            return null;
        }

        return value;
    }

    private static bool? ReadOptionalBoolean(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && (property.ValueKind == JsonValueKind.True || property.ValueKind == JsonValueKind.False)
            ? property.GetBoolean()
            : null;
    }

    private static int ReadOptionalInt(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value)
            ? value
            : 0;
    }

    private static double? ReadOptionalDouble(JsonElement element, string propertyName, double min, double max)
        => ReadOptionalDouble(element, propertyName, min, max, null);

    private static double? ReadOptionalDouble(JsonElement element, string propertyName, double min, double max, List<object>? issues)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind != JsonValueKind.Number || !property.TryGetDouble(out var value) || value < min || value > max)
        {
            issues?.Add(new { code = "invalid_number", path = new[] { propertyName }, message = "Invalid companion settings" });
            return null;
        }

        return value;
    }

    private static object CreateInvalidTypeIssue(string[] path, string expected, string received, string message)
        => new { code = "invalid_type", expected, received, path, message };

    private static string DescribeKind(JsonValueKind kind) => kind switch
    {
        JsonValueKind.String => "string",
        JsonValueKind.Number => "number",
        JsonValueKind.True or JsonValueKind.False => "boolean",
        JsonValueKind.Object => "object",
        JsonValueKind.Array => "array",
        JsonValueKind.Null => "null",
        _ => "unknown",
    };
}

internal sealed record CompanionSettingsState(
    IReadOnlyDictionary<string, CompanionAgentBindingResponse> Bindings,
    CompanionPreferencesResponse Preferences,
    CompanionAgentBindingResponse? ActiveBinding,
    CompanionProfileResponse Profile,
    string? UpdatedAt);

public sealed record CompanionPreferencesPartial(
    bool? Enabled,
    bool? Muted,
    bool? ReducedMotion,
    string? Verbosity,
    string? InjectionMode,
    string? ThemeVariant,
    bool? VoiceOutputEnabled,
    string? VoiceOutputMode,
    double? VoiceRate,
    string? VoiceVariant);

public sealed record CompanionSettingsUpdate(
    IReadOnlyDictionary<string, CompanionAgentBindingResponse>? Bindings,
    CompanionPreferencesPartial? Preferences);

public sealed record CompanionChatContext(
    bool? SessionBusy,
    int PendingApprovals,
    int PendingQuestions,
    int RunningTasks,
    int BlockedTasks,
    int TodoCount);

public sealed record CompanionChatRequest(
    string Message,
    CompanionChatContext? Context,
    string? AgentId,
    string? ApiBaseUrl,
    string? ApiKey,
    string Model);
