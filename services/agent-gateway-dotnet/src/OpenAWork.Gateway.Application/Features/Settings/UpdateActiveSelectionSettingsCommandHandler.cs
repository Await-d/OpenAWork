using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Persistence;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class UpdateActiveSelectionSettingsCommandHandler(
    ICurrentUser currentUser,
    IUserSettingsWriter userSettingsWriter) : IRequestHandler<UpdateActiveSelectionSettingsCommand, OkResponse>
{
    public async Task<OkResponse> Handle(UpdateActiveSelectionSettingsCommand request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await userSettingsWriter.UpsertAsync(userId, "active_selection", request.ActiveSelection.GetRawText(), cancellationToken);
        return new OkResponse(true);
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
