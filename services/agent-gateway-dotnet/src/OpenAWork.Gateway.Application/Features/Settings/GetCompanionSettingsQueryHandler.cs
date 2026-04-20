using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class GetCompanionSettingsQueryHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader) : IRequestHandler<GetCompanionSettingsQuery, CompanionSettingsResponse>
{
    public async Task<CompanionSettingsResponse> Handle(GetCompanionSettingsQuery request, CancellationToken cancellationToken)
    {
        var (userId, email) = RequireUser();
        var stored = await userSettingsReader.GetValueAsync(userId, CompanionSettingsSupport.SettingsKey, cancellationToken);
        var settings = CompanionSettingsSupport.Load(stored, email, request.AgentId);
        return new CompanionSettingsResponse(
            settings.ActiveBinding,
            settings.Bindings,
            CompanionSettingsSupport.BuildFeatureState(settings.Preferences),
            settings.Preferences,
            settings.Profile);
    }

    private (string UserId, string Email) RequireUser()
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId) || string.IsNullOrWhiteSpace(currentUser.Email))
        {
            throw new UnauthorizedAccessException("Authenticated user is required.");
        }

        return (currentUser.UserId, currentUser.Email);
    }
}
