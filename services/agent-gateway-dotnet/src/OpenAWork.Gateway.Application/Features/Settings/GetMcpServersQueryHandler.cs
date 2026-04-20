using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetMcpServersQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetMcpServersQuery, McpServersResponse>
{
    private static readonly JsonElement EmptyServers = JsonSerializer.SerializeToElement(Array.Empty<object>());

    public async Task<McpServersResponse> Handle(GetMcpServersQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var value = await userSettingsReader.GetValueAsync(userId, "mcp_servers", cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new McpServersResponse(EmptyServers);
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            return new McpServersResponse(document.RootElement.Clone());
        }
        catch (JsonException)
        {
            return new McpServersResponse(EmptyServers);
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
