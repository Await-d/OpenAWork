using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Capabilities;

namespace OpenAWork.Gateway.Application.Features.Capabilities;

public sealed class GetCapabilitiesQueryHandler(
    ICurrentUser currentUser,
    IInstalledSkillReader installedSkillReader,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetCapabilitiesQuery, CapabilitiesResponse>
{
    public async Task<CapabilitiesResponse> Handle(GetCapabilitiesQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var installedSkills = await installedSkillReader.ListEnabledManifestsAsync(userId, cancellationToken);
        var mcpRaw = await userSettingsReader.GetValueAsync(userId, "mcp_servers", cancellationToken);
        var dynamicSkills = ParseInstalledSkills(installedSkills);
        var configuredMcps = ParseConfiguredMcps(mcpRaw);
        var tools = CapabilityCatalogStaticData.BuildToolCapabilities(presentedNames: true);

        var capabilities = new List<CapabilityDescriptorResponse>();
        capabilities.AddRange(CapabilityCatalogStaticData.BuiltinAgents);
        capabilities.AddRange(CapabilityCatalogStaticData.BuiltinSkills);
        capabilities.AddRange(CapabilityCatalogStaticData.ReferenceSkills);
        capabilities.AddRange(dynamicSkills);
        capabilities.AddRange(CapabilityCatalogStaticData.BuiltinMcps);
        capabilities.AddRange(configuredMcps);
        capabilities.AddRange(tools);
        capabilities.AddRange(CapabilityCatalogStaticData.Commands);

        var sorted = capabilities
            .OrderBy((item) => KindOrder(item.Kind))
            .ThenBy((item) => item.Label, StringComparer.Create(System.Globalization.CultureInfo.GetCultureInfo("zh-CN"), false))
            .ToList();

        return new CapabilitiesResponse(sorted);
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }

    private static IReadOnlyList<CapabilityDescriptorResponse> ParseInstalledSkills(IReadOnlyList<InstalledSkillManifestEntry> manifests)
    {
        var items = new List<CapabilityDescriptorResponse>();
        foreach (var manifestEntry in manifests)
        {
            try
            {
                using var document = JsonDocument.Parse(manifestEntry.ManifestJson);
                var root = document.RootElement;
                items.Add(new CapabilityDescriptorResponse(
                    Id: ReadString(root, "id") ?? manifestEntry.SkillId,
                    Kind: "skill",
                    Label: ReadString(root, "displayName") ?? ReadString(root, "name") ?? manifestEntry.SkillId,
                    Description: ReadString(root, "description") ?? "已安装技能",
                    Source: "installed",
                    Tags: root.TryGetProperty("capabilities", out var capabilities) && capabilities.ValueKind == JsonValueKind.Array
                        ? capabilities.EnumerateArray().Where((item) => item.ValueKind == JsonValueKind.String).Select((item) => item.GetString() ?? string.Empty).Where((value) => value.Length > 0).ToArray()
                        : null,
                    Enabled: true,
                    Callable: false,
                    CanonicalRole: null,
                    Aliases: null));
            }
            catch (JsonException)
            {
            }
        }

        return items;
    }

    private static IReadOnlyList<CapabilityDescriptorResponse> ParseConfiguredMcps(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return document.RootElement.EnumerateArray().Select((server) => new CapabilityDescriptorResponse(
                Id: ReadString(server, "id") ?? ReadString(server, "name") ?? "mcp",
                Kind: "mcp",
                Label: ReadString(server, "name") ?? ReadString(server, "id") ?? "MCP",
                Description: $"用户配置的 MCP server ({ReadString(server, "type") ?? "unknown"})",
                Source: "configured",
                Tags: null,
                Enabled: server.TryGetProperty("enabled", out var enabled) ? enabled.ValueKind != JsonValueKind.False : true,
                Callable: false,
                CanonicalRole: null,
                Aliases: null)).ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string? ReadString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;

    private static int KindOrder(string kind) => kind switch
    {
        "agent" => 0,
        "skill" => 1,
        "mcp" => 2,
        "tool" => 3,
        "command" => 4,
        _ => 9,
    };
}
