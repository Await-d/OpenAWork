using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Auth;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class LoginCommandHandler(
    IUserAuthStore userAuthStore,
    IPasswordHasher passwordHasher,
    IJwtTokenIssuer jwtTokenIssuer,
    IRefreshTokenFactory refreshTokenFactory,
    IRefreshTokenStore refreshTokenStore) : IRequestHandler<LoginCommand, LoginResponse>
{
    public async Task<LoginResponse> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var user = await userAuthStore.FindByEmailAsync(request.Email, cancellationToken);
        if (user is null || !passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            throw new UnauthorizedAccessException("Invalid credentials");
        }

        if (passwordHasher.NeedsRehash(user.PasswordHash))
        {
            await userAuthStore.UpdatePasswordHashAsync(user.Id, passwordHasher.HashPassword(request.Password), cancellationToken);
        }

        var refreshToken = refreshTokenFactory.Create();
        await refreshTokenStore.AddAsync(user.Id, refreshToken.TokenHash, refreshToken.ExpiresAtUtc, cancellationToken);

        return new LoginResponse(
            AccessToken: jwtTokenIssuer.IssueAccessToken(user.Id, user.Email),
            RefreshToken: refreshToken.Token,
            ExpiresIn: jwtTokenIssuer.ExpiresIn);
    }
}
