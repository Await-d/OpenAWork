using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Application.Abstractions.Observability;
using OpenAWork.Gateway.Contracts.Settings;

namespace OpenAWork.Gateway.Application.Features.Settings;

public sealed class DeleteDiagnosticsCommandHandler(
    ICurrentUser currentUser,
    IRequestWorkflowLogStore requestWorkflowLogStore) : IRequestHandler<DeleteDiagnosticsCommand, OkResponse>
{
    public async Task<OkResponse> Handle(DeleteDiagnosticsCommand request, CancellationToken cancellationToken)
    {
        var userId = RequireUserId();
        await requestWorkflowLogStore.DeleteErrorLogsByUserAsync(userId, cancellationToken);
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
