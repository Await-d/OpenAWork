using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Auth;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class RefreshAccessTokenCommandHandler(
    IRefreshTokenFactory refreshTokenFactory,
    IRefreshTokenStore refreshTokenStore,
    IUserAuthStore userAuthStore,
    IJwtTokenIssuer jwtTokenIssuer) : IRequestHandler<RefreshAccessTokenCommand, RefreshResponse>
{
    public async Task<RefreshResponse> Handle(RefreshAccessTokenCommand request, CancellationToken cancellationToken)
    {
        var currentTokenHash = refreshTokenFactory.Hash(request.RefreshToken);
        var existingToken = await refreshTokenStore.FindValidByHashAsync(currentTokenHash, DateTimeOffset.UtcNow, cancellationToken);
        if (existingToken is null)
        {
            throw new UnauthorizedAccessException("Invalid or expired refresh token");
        }

        var user = await userAuthStore.FindByIdAsync(existingToken.UserId, cancellationToken);
        if (user is null)
        {
            throw new UnauthorizedAccessException("User not found");
        }

        var deletedCount = await refreshTokenStore.DeleteByHashAsync(currentTokenHash, cancellationToken);
        if (deletedCount != 1)
        {
            throw new UnauthorizedAccessException("Invalid or expired refresh token");
        }

        var refreshToken = refreshTokenFactory.Create();
        await refreshTokenStore.AddAsync(user.Id, refreshToken.TokenHash, refreshToken.ExpiresAtUtc, cancellationToken);

        return new RefreshResponse(
            AccessToken: jwtTokenIssuer.IssueAccessToken(user.Id, user.Email),
            RefreshToken: refreshToken.Token,
            ExpiresIn: jwtTokenIssuer.ExpiresIn);
    }
}
