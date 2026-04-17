using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetFilePatternsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetFilePatternsQuery, FilePatternsResponse>
{
    public async Task<FilePatternsResponse> Handle(GetFilePatternsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var value = await userSettingsReader.GetValueAsync(userId, "file_patterns", cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new FilePatternsResponse([]);
        }

        try
        {
            var patterns = System.Text.Json.JsonSerializer.Deserialize<List<string>>(value);
            return new FilePatternsResponse(patterns ?? []);
        }
        catch (System.Text.Json.JsonException)
        {
            return new FilePatternsResponse([]);
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
