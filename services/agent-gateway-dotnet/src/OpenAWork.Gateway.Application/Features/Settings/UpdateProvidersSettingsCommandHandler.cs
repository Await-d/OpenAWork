using System.Text.Json;
using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class UpdateProvidersSettingsCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsReader userSettingsReader,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<UpdateProvidersSettingsCommand, ProvidersSettingsResponse>
{
    public async Task<ProvidersSettingsResponse> Handle(UpdateProvidersSettingsCommand request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();

        var storedSelection = await userSettingsReader.GetValueAsync(userId, "active_selection", cancellationToken);
        var storedThinking = await userSettingsReader.GetValueAsync(userId, "default_thinking", cancellationToken);

        var materializedProviders = ProviderSettingsMaterializer.MaterializeProviders(request.Providers);
        var activeSelection = ProviderSettingsMaterializer.MaterializeActiveSelection(
            materializedProviders,
            request.RequestedActiveSelection is not null ? request.RequestedActiveSelection.Value.GetRawText() : storedSelection);
        var defaultThinking = request.RequestedDefaultThinking ?? GetProvidersSettingsQueryHandler.ParseDefaultThinking(storedThinking);

        await userSettingsWriter.UpsertAsync(
            userId,
            "providers",
            JsonSerializer.Serialize(materializedProviders),
            cancellationToken);

        await userSettingsWriter.UpsertAsync(
            userId,
            "active_selection",
            JsonSerializer.Serialize(activeSelection),
            cancellationToken);

        await userSettingsWriter.UpsertAsync(
            userId,
            "default_thinking",
            defaultThinking.GetRawText(),
            cancellationToken);

        return new ProvidersSettingsResponse(materializedProviders, activeSelection, defaultThinking);
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
