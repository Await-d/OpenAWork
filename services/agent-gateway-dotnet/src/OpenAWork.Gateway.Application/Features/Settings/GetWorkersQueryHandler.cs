using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetWorkersQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetWorkersQuery, WorkersResponse>
{
    public async Task<WorkersResponse> Handle(GetWorkersQuery request, CancellationToken cancellationToken)
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        var value = await userSettingsReader.GetValueAsync(currentUser.UserId, "workers", cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new WorkersResponse([]);
        }

        try
        {
            var workers = JsonSerializer.Deserialize<List<JsonElement>>(value);
            return new WorkersResponse(workers ?? []);
        }
        catch (JsonException)
        {
            return new WorkersResponse([]);
        }
    }
}
