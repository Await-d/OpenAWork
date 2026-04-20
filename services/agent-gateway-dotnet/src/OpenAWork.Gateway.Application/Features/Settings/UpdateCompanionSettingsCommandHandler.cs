using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class UpdateCompanionSettingsCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<UpdateCompanionSettingsCommand, CompanionSettingsResponse>
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public async Task<CompanionSettingsResponse> Handle(UpdateCompanionSettingsCommand request, CancellationToken cancellationToken)
    {
        var (userId, email) = RequireUser();
        var stored = await userSettingsReader.GetValueAsync(userId, CompanionSettingsSupport.SettingsKey, cancellationToken);
        var existing = CompanionSettingsSupport.Load(stored, email, request.AgentId);
        var merged = CompanionSettingsSupport.MergeUpdate(existing, request.Update, email, request.AgentId);
        await userSettingsWriter.UpsertAsync(userId, CompanionSettingsSupport.SettingsKey, JsonSerializer.Serialize(CompanionSettingsSupport.BuildStoredPayload(merged), JsonOptions), cancellationToken);

        return new CompanionSettingsResponse(
            merged.ActiveBinding,
            merged.Bindings,
            CompanionSettingsSupport.BuildFeatureState(merged.Preferences),
            merged.Preferences,
            merged.Profile);
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
