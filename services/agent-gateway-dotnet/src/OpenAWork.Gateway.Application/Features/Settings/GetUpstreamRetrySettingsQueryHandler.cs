using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetUpstreamRetrySettingsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetUpstreamRetrySettingsQuery, UpstreamRetrySettingsResponse>
{
    private const string UpstreamRetrySettingsKey = "upstream_retry_policy_v1";

    public async Task<UpstreamRetrySettingsResponse> Handle(GetUpstreamRetrySettingsQuery request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        var value = await userSettingsReader.GetValueAsync(userId, UpstreamRetrySettingsKey, cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return new UpstreamRetrySettingsResponse(3);
        }

        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(value);
            var maxRetries = document.RootElement.TryGetProperty("maxRetries", out var retriesElement) && retriesElement.TryGetInt32(out var retries)
                ? Math.Clamp(retries, 0, 3)
                : 3;
            return new UpstreamRetrySettingsResponse(maxRetries);
        }
        catch (System.Text.Json.JsonException)
        {
            return new UpstreamRetrySettingsResponse(3);
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
