using MediatR;
using OpenAWork.Gateway.Application.Abstractions.Auth;
using OpenAWork.Gateway.Contracts.Auth;
using OpenAWork.Gateway.Domain.Errors;

namespace OpenAWork.Gateway.Application.Features.Auth;

public sealed class RegisterCommandHandler(
    IUserAuthStore userAuthStore,
    IPasswordHasher passwordHasher,
    IUserRegistrationBootstrapper registrationBootstrapper) : IRequestHandler<RegisterCommand, RegisterResponse>
{
    public async Task<RegisterResponse> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        if (await userAuthStore.ExistsByEmailAsync(request.Email, cancellationToken))
        {
            throw new GatewayConflictException("Email already registered");
        }

        var user = new AuthUser(
            Id: Guid.NewGuid().ToString(),
            Email: request.Email,
            PasswordHash: passwordHasher.HashPassword(request.Password));

        var added = await userAuthStore.TryAddUserAsync(user, cancellationToken);
        if (!added)
        {
            throw new GatewayConflictException("Email already registered");
        }

        await registrationBootstrapper.EnsureDefaultsForUserAsync(user.Id, cancellationToken);

        return new RegisterResponse(true);
    }
}
