using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Auth;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class LogoutCurrentUserCommandHandler(
    ICurrentUser currentUser,
    IRefreshTokenStore refreshTokenStore) : IRequestHandler<LogoutCurrentUserCommand, LogoutResponse>
{
    public async Task<LogoutResponse> Handle(LogoutCurrentUserCommand request, CancellationToken cancellationToken)
    {
        if (!currentUser.IsAuthenticated || string.IsNullOrWhiteSpace(currentUser.UserId))
        {
            throw new UnauthorizedAccessException("Unauthorized");
        }

        await refreshTokenStore.DeleteByUserIdAsync(currentUser.UserId, cancellationToken);
        return new LogoutResponse(true);
    }
}
