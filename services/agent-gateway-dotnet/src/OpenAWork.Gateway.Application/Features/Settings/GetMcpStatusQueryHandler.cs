using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetMcpStatusQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetMcpStatusQuery, McpStatusResponse>
{
    public async Task<McpStatusResponse> Handle(GetMcpStatusQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var value = await userSettingsReader.GetValueAsync(userId, "mcp_servers", cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new McpStatusResponse([]);
        }

        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array)
            {
                return new McpStatusResponse([]);
            }

            var servers = new List<McpStatusServerItem>();
            foreach (var server in document.RootElement.EnumerateArray())
            {
                if (server.ValueKind != System.Text.Json.JsonValueKind.Object)
                {
                    continue;
                }

                var id = server.TryGetProperty("id", out var idElement) && idElement.ValueKind == System.Text.Json.JsonValueKind.String
                    ? idElement.GetString() ?? string.Empty
                    : string.Empty;
                var name = server.TryGetProperty("name", out var nameElement) && nameElement.ValueKind == System.Text.Json.JsonValueKind.String
                    ? nameElement.GetString() ?? string.Empty
                    : string.Empty;
                var type = server.TryGetProperty("type", out var typeElement) && typeElement.ValueKind == System.Text.Json.JsonValueKind.String
                    ? typeElement.GetString() ?? "stdio"
                    : "stdio";
                var enabled = !server.TryGetProperty("enabled", out var enabledElement)
                    || enabledElement.ValueKind != System.Text.Json.JsonValueKind.False;

                servers.Add(new McpStatusServerItem(id, name, type, "unknown", enabled));
            }

            return new McpStatusResponse(servers);
        }
        catch (System.Text.Json.JsonException)
        {
            return new McpStatusResponse([]);
        }
    }

    private string RequireUserId()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return currentUser.UserId;
    }
}
